import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import axios from "axios";
import { SimliClient, LogLevel } from "simli-client";
import { FaMicrophone } from "react-icons/fa";

const TRANSCRIBE_URL = "http://localhost:8000/transcribe";
const SPEAK_URL = "http://localhost:8000/speak";
const SIMLI_TOKEN_URL = "http://localhost:8000/simli/token";

// How long we wait for the candidate to START speaking before skipping.
const NO_SPEECH_MS = 15000;

// How long of silence AFTER the candidate speaks means the answer is done.
const SILENCE_MS = 3500;

// Mic volume (0-1) above this counts as the candidate speaking. Kept low so
// quiet laptop mics still register real speech.
const VOICE_LEVEL = 0.008;

// How often we sample the microphone.
const CHECK_MS = 50;

// Samples used to measure the room's background noise before listening.
const CALIBRATE_FRAMES = 6;

// Threshold = background noise * this multiplier (capped by MAX_THRESHOLD).
const NOISE_MULTIPLIER = 1.8;

// The threshold never goes above this, so normal speech always passes.
const MAX_THRESHOLD = 0.02;

// Speech is detected when at least VOICE_MIN_HITS of the last VOICE_WINDOW
// samples are loud. This tolerates the natural dips between words.
const VOICE_WINDOW = 8;
const VOICE_MIN_HITS = 3;

// Short phrases Whisper invents from silence or background noise.
const HALLUCINATIONS = new Set([
  "",
  ".",
  "you",
  "thank you",
  "thanks",
  "bye",
  "okay",
]);

// Sent to the backend when the candidate gives no answer, so the
// interviewer can move on without praising them.
const NO_ANSWER =
  "[Candidate did not provide an answer to the previous question.]";

const PHASE_LABELS = {
  connecting: "Connecting...",
  speaking: "The interviewer is speaking...",
  ready: "Your turn to answer",
  listening: "Listening... please speak now",
  recording: "Recording your answer...",
  transcribing: "Transcribing your answer...",
  waiting: "Waiting for the next question...",
  completed: "Interview complete - thanks for participating!",
  disconnected: "Disconnected",
};

// Phase status pills shown near the mic, so state is never color-only.
const STATUS = {
  connecting: { text: PHASE_LABELS.connecting, dot: "bg-slate-400" },
  speaking: { text: PHASE_LABELS.speaking, dot: "bg-violet-400 animate-pulse" },
  ready: { text: PHASE_LABELS.ready, dot: "bg-violet-400" },
  listening: { text: PHASE_LABELS.listening, dot: "bg-amber-400 animate-pulse" },
  recording: { text: PHASE_LABELS.recording, dot: "bg-red-500 animate-pulse" },
  transcribing: { text: PHASE_LABELS.transcribing, dot: "bg-amber-400 animate-pulse" },
  waiting: { text: PHASE_LABELS.waiting, dot: "bg-slate-400" },
  completed: { text: PHASE_LABELS.completed, dot: "bg-emerald-400" },
  disconnected: { text: PHASE_LABELS.disconnected, dot: "bg-red-500" },
};

function InterviewRoom() {
  const location = useLocation();
  const navigate = useNavigate();

  const [phase, setPhase] = useState("connecting");
  const [currentSpeech, setCurrentSpeech] = useState("");
  const [answer, setAnswer] = useState("");
  const [questionNumber, setQuestionNumber] = useState(0);
  const [totalQuestions, setTotalQuestions] = useState(2);
  const [voiceError, setVoiceError] = useState("");
  const [micError, setMicError] = useState("");
  const [started, setStarted] = useState(false);
  // "connecting" | "ready" | "error" — drives the avatar frame placeholder.
  const [avatarStatus, setAvatarStatus] = useState("connecting");

  const socketRef = useRef(null);
  const audioRef = useRef(null);
  const audioUrlRef = useRef(null);
  const lastSpokenRef = useRef("");

  // Simli AI avatar elements and connection.
  const avatarVideoRef = useRef(null);
  const avatarAudioRef = useRef(null);
  const simliClientRef = useRef(null);
  const avatarReadyRef = useRef(false);
  const avatarFailedRef = useRef(false);
  const awaitingSilenceRef = useRef(false);
  const silenceTimerRef = useRef(null);
  // When the current line's audio started and how long it is, so the closing
  // message is never cut off and never navigates before it finishes speaking.
  const speechStartedAtRef = useRef(0);
  const speechDurationRef = useRef(0);

  const streamRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const intervalRef = useRef(null);
  const analyserRef = useRef(null);
  const audioCtxRef = useRef(null);

  const phaseRef = useRef("connecting");
  const listenStartRef = useRef(0);
  const lastVoiceRef = useRef(0);
  const doneRef = useRef(false);

  const role = location.state?.role;
  const resume = location.state?.resume;

  // Keep the phase available to timer callbacks without stale closures.
  const changePhase = useCallback((next) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  // Called once the avatar has finished voicing a line (or the safety timer fires).
  const endAvatarTurn = useCallback(() => {
    if (!awaitingSilenceRef.current) return;

    // Never cut the closing line short: if the avatar's "silent" event fired
    // before the full spoken duration elapsed, ignore it and let the safety
    // timer do the navigation once the audio has really finished.
    if (doneRef.current && speechStartedAtRef.current) {
      const elapsed = Date.now() - speechStartedAtRef.current;
      if (elapsed < speechDurationRef.current) return;
    }

    awaitingSilenceRef.current = false;

    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }

    if (doneRef.current) {
      changePhase("completed");
      navigate("/dashboard", { replace: true });
    } else {
      changePhase("ready");
    }
  }, [changePhase, navigate]);

  // Wait (bounded) for the Simli avatar so it can voice the next line.
  const waitForAvatar = useCallback(
    (timeoutMs) =>
      new Promise((resolve) => {
        const start = Date.now();
        const check = () => {
          if (avatarReadyRef.current) return resolve(true);
          if (avatarFailedRef.current || Date.now() - start > timeoutMs) {
            return resolve(false);
          }
          setTimeout(check, 150);
        };
        check();
      }),
    []
  );

  // Resume/subscribe the avatar's audio. The browser blocks autoplay until the
  // user interacts, so we force it to play from a gesture handler.
  const playAvatarAudio = useCallback(() => {
    const audio = avatarAudioRef.current;
    if (!audio) return;
    audio.muted = false;
    audio.play().catch(() => {});
  }, []);

  // Stream one PCM16 @16kHz line to the avatar and detect when it finishes.
  const deliverAvatarSpeech = useCallback(
    async (bytes) => {
      const client = simliClientRef.current;
      if (!client || !bytes || bytes.byteLength === 0) return;

      changePhase("speaking");
      awaitingSilenceRef.current = true;

      // 2 bytes per sample, 16000 samples per second.
      const durationMs = Math.max(600, (bytes.byteLength / 32000) * 1000);
      speechStartedAtRef.current = Date.now();
      speechDurationRef.current = durationMs;

      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = setTimeout(() => {
        if (awaitingSilenceRef.current) endAvatarTurn();
      }, durationMs + 3000);

      playAvatarAudio();
      client.sendAudioData(bytes);
    },
    [changePhase, endAvatarTurn, playAvatarAudio]
  );

  // Send the candidate's answer (or the no-answer marker) to the backend.
  const sendAnswer = useCallback(
    (text) => {
      changePhase("waiting");
      socketRef.current?.send(text);
    },
    [changePhase]
  );

  // Turn a recorded blob into text and send it to the backend.
  const handleBlob = useCallback(
    async (blob) => {
      if (!blob || blob.size === 0) {
        sendAnswer(NO_ANSWER);
        return;
      }

      changePhase("transcribing");

      try {
        const formData = new FormData();
        formData.append("file", blob, "answer.webm");

        const { data } = await axios.post(TRANSCRIBE_URL, formData);
        const text = (data.text || "").trim();
        const meaningful = text && !HALLUCINATIONS.has(text.toLowerCase());

        setAnswer(meaningful ? text : "");
        sendAnswer(meaningful ? text : NO_ANSWER);
      } catch {
        setMicError("Could not transcribe your answer.");
        sendAnswer(NO_ANSWER);
      }
    },
    [changePhase, sendAnswer]
  );

  // Stop the microphone level meter.
  const stopVad = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    analyserRef.current?.disconnect();
    analyserRef.current = null;

    audioCtxRef.current?.close();
    audioCtxRef.current = null;
  }, []);

  // Stop the recorder and return the recorded audio as a blob.
  const stopRecorder = useCallback(
    () =>
      new Promise((resolve) => {
        const recorder = mediaRecorderRef.current;

        if (!recorder || recorder.state === "inactive") {
          streamRef.current?.getTracks().forEach((track) => track.stop());
          streamRef.current = null;
          resolve(null);
          return;
        }

        recorder.onstop = () => {
          const blob = new Blob(chunksRef.current, { type: "audio/webm" });
          chunksRef.current = [];

          streamRef.current?.getTracks().forEach((track) => track.stop());
          streamRef.current = null;
          mediaRecorderRef.current = null;

          resolve(blob);
        };

        recorder.stop();
      }),
    []
  );

  // Candidate finished speaking -> transcribe and submit the answer.
  const finishAnswer = useCallback(async () => {
    stopVad();
    const blob = await stopRecorder();
    await handleBlob(blob);
  }, [stopVad, stopRecorder, handleBlob]);

  // Candidate stayed silent too long -> skip to the next question.
  const skipAnswer = useCallback(async () => {
    stopVad();
    await stopRecorder();
    sendAnswer(NO_ANSWER);
  }, [stopVad, stopRecorder, sendAnswer]);

  // Stop listening and throw away whatever was recorded (used before the AI speaks).
  const cancelListening = useCallback(async () => {
    stopVad();
    await stopRecorder();
  }, [stopVad, stopRecorder]);

  // Turn the mic on and watch for speech, silence, and the no-speech timeout.
  const startListening = useCallback(async () => {
    if (doneRef.current || phaseRef.current === "listening") return;

    setMicError("");
    setAnswer("");
    changePhase("listening");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true, // boosts quiet speech
          channelCount: 1,
        },
      });

      streamRef.current = stream;
      chunksRef.current = [];

      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.start();
      mediaRecorderRef.current = recorder;

      // Measure mic volume to detect when the candidate speaks and stops.
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioCtx();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);

      if (audioCtx.state === "suspended") await audioCtx.resume();

      audioCtxRef.current = audioCtx;
      analyserRef.current = analyser;

      // Float samples are more precise than 8-bit, which helps quiet speech.
      const samples = new Float32Array(analyser.fftSize);

      const readLevel = () => {
        analyser.getFloatTimeDomainData(samples);

        let sum = 0;
        for (let i = 0; i < samples.length; i++) {
          sum += samples[i] * samples[i];
        }

        return Math.sqrt(sum / samples.length);
      };

      // 1. Calibrate using the MINIMUM level seen, so any speech during this
      // window can't raise the threshold too high to detect.
      let noiseFloor = 1;
      for (let i = 0; i < CALIBRATE_FRAMES; i++) {
        noiseFloor = Math.min(noiseFloor, readLevel());
        await new Promise((resolve) => setTimeout(resolve, CHECK_MS));
      }

      // 2. Lower, capped threshold so normal-volume speech always passes.
      const threshold = Math.max(
        VOICE_LEVEL,
        Math.min(noiseFloor * NOISE_MULTIPLIER, MAX_THRESHOLD)
      );
      // Easier to STAY in "speaking" than to start, so soft word endings
      // and trailing words don't count as silence.
      const stopThreshold = threshold * 0.6;

      // Sliding window of recent loud/quiet samples.
      const recent = [];

      // 3. The no-speech countdown starts here, once the mic is live and
      // calibrated - not before the permission prompt.
      listenStartRef.current = Date.now();
      lastVoiceRef.current = Date.now();

      intervalRef.current = setInterval(() => {
        const level = readLevel();
        const now = Date.now();

        recent.push(level > threshold);
        if (recent.length > VOICE_WINDOW) recent.shift();
        const hits = recent.filter(Boolean).length;

        if (phaseRef.current === "listening" && hits >= VOICE_MIN_HITS) {
          lastVoiceRef.current = now;
          changePhase("recording");
        }

        if (phaseRef.current === "recording") {
          if (level > stopThreshold) lastVoiceRef.current = now;

          if (now - lastVoiceRef.current > SILENCE_MS) {
            finishAnswer();
            return;
          }
        }

        if (
          phaseRef.current === "listening" &&
          now - listenStartRef.current > NO_SPEECH_MS
        ) {
          skipAnswer();
        }
      }, CHECK_MS);
    } catch {
      stopVad();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setMicError("Could not start the microphone.");
      changePhase("ready");
    }
  }, [changePhase, finishAnswer, skipAnswer, stopVad]);

  // Play the interviewer's voice, then hand the turn to the candidate.
  const playAudio = useCallback(
    async (blob) => {
      await cancelListening();

      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current);
      }

      const url = URL.createObjectURL(blob);
      audioUrlRef.current = url;

      audioRef.current?.pause();

      const audio = new Audio();
      audio.src = url;

      audio.onended = () => {
        if (doneRef.current) {
          changePhase("completed");
          navigate("/dashboard", { replace: true });
        } else {
          changePhase("ready");
        }
      };

      audioRef.current = audio;

      changePhase("speaking");

      try {
        await audio.play();
      } catch {
        setVoiceError("Your browser blocked the interviewer's audio.");
        changePhase("ready");
      }
    },
    [cancelListening, changePhase, navigate]
  );

  // Send the question text to the backend and voice it on the avatar,
  // falling back to plain audio when the avatar is unavailable.
  const speak = useCallback(
    async (text) => {
      const trimmed = (text || "").trim();

      if (!trimmed) return;

      setVoiceError("");

      const useAvatar = await waitForAvatar(8000);

      try {
        if (useAvatar && simliClientRef.current) {
          const { data } = await axios.post(
            SPEAK_URL,
            { text: trimmed, format: "pcm" },
            { responseType: "arraybuffer" }
          );

          await deliverAvatarSpeech(new Uint8Array(data));
        } else {
          const { data } = await axios.post(
            SPEAK_URL,
            { text: trimmed },
            { responseType: "blob" }
          );

          await playAudio(data);
        }
      } catch {
        setVoiceError("Could not generate the interviewer's voice.");
        changePhase("ready");
      }
    },
    [waitForAvatar, deliverAvatarSpeech, playAudio, changePhase]
  );

  // Bring up the Simli avatar once the room (and its DOM refs) are available.
  useEffect(() => {
    if (!role || !resume) return;

    let cancelled = false;

    const initAvatar = async () => {
      try {
        if (!cancelled) setAvatarStatus("connecting");

        const { data } = await axios.get(SIMLI_TOKEN_URL);
        const token = data?.session_token;

        if (
          !token ||
          cancelled ||
          !avatarVideoRef.current ||
          !avatarAudioRef.current
        ) {
          avatarFailedRef.current = true;
          if (!cancelled) setAvatarStatus("error");
          return;
        }

        const client = new SimliClient(
          token,
          avatarVideoRef.current,
          avatarAudioRef.current,
          null,
          LogLevel.INFO,
          "livekit"
        );

        client.on("speaking", () => {
          playAvatarAudio();
          if (awaitingSilenceRef.current) changePhase("speaking");
        });
        client.on("silent", () => endAvatarTurn());
        client.on("error", (message) =>
          setVoiceError("Avatar error: " + message)
        );
        client.on("startup_error", (message) =>
          setVoiceError("Avatar error: " + message)
        );

        await client.start();

        if (cancelled) {
          client.stop();
          return;
        }

        simliClientRef.current = client;
        avatarReadyRef.current = true;
        setAvatarStatus("ready");
      } catch {
        avatarFailedRef.current = true;
        if (!cancelled) setAvatarStatus("error");
        setVoiceError("Could not start the AI avatar. Falling back to voice only.");
      }
    };

    initAvatar();

    return () => {
      cancelled = true;
      const client = simliClientRef.current;
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      simliClientRef.current = null;
      avatarReadyRef.current = false;
      if (client) client.stop();
    };
  }, [role, resume, changePhase, endAvatarTurn, playAvatarAudio]);

  // Any interaction afterward must never silence the avatar's audio.
  useEffect(() => {
    const unlock = () => playAvatarAudio();
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);

    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [playAvatarAudio]);

  // Connect to the backend.
  useEffect(() => {
    if (!role || !resume) {
      navigate("/ai-interview", { replace: true });
      return;
    }

    if (!started) return;

    const socket = new WebSocket("ws://localhost:8000/ws");
    socketRef.current = socket;

    // Guards against stale callbacks from a socket that StrictMode created
    // and closed while re-running this effect. Without it a dead socket's
    // late onclose/onmessage can flip the phase or reset the question count.
    let disposed = false;

    socket.onopen = () => {
      if (disposed) return;
      changePhase("waiting");

      const reader = new FileReader();

      reader.onload = () => {
        if (disposed) return;
        const base64 = reader.result.split(",")[1];

        socket.send(
          JSON.stringify({
            role,
            resume: base64,
            filename: resume.name,
          })
        );
      };

      reader.readAsDataURL(resume);
    };

    socket.onmessage = (event) => {
      if (disposed) return;
      try {
        const data = JSON.parse(event.data);

        setCurrentSpeech(data.content);
        // The count only ever climbs, so late/duplicate messages from a
        // replaced socket can never send it backwards.
        setQuestionNumber((prev) => Math.max(prev, data.asked || 0));
        setTotalQuestions(data.total);

        if (data.type === "closing" || data.stage === "done") {
          doneRef.current = true;
          changePhase("completed");
        }
      } catch {
        setCurrentSpeech(event.data);
      }
    };

    socket.onclose = () => {
      if (disposed) return;
      if (!doneRef.current) changePhase("disconnected");
    };

    return () => {
      disposed = true;
      socket.close();
    };
  }, [role, resume, navigate, changePhase, started]);

  // Speak every new question the backend sends.
  useEffect(() => {
    const text = (currentSpeech || "").trim();

    if (!text || text === lastSpokenRef.current) return;

    lastSpokenRef.current = text;
    speak(text);
  }, [currentSpeech, speak]);

  // If the candidate never clicks the mic, skip to the next question so the
  // interview keeps moving. Cancelled the moment startListening() runs.
  useEffect(() => {
    if (phase !== "ready") return;

    const timer = setTimeout(() => skipAnswer(), NO_SPEECH_MS);
    return () => clearTimeout(timer);
  }, [phase, skipAnswer]);

  // Release the microphone, recorder, and audio when leaving the room.
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      analyserRef.current?.disconnect();
      audioCtxRef.current?.close();

      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== "inactive") recorder.stop();

      streamRef.current?.getTracks().forEach((track) => track.stop());
      audioRef.current?.pause();
      simliClientRef.current?.stop();
      simliClientRef.current = null;

      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    };
  }, []);

  if (!role || !resume) {
    return null;
  }

  const isSpeaking = phase === "speaking";
  const canAnswer = phase === "ready";
  const micBusy =
    phase === "listening" || phase === "recording" || phase === "transcribing";
  const status = STATUS[phase] || { text: phase, dot: "bg-slate-400" };

  return (
    <div className="min-h-screen bg-[#0a0f1f] text-slate-100">
      <div className="mx-auto max-w-3xl px-4 py-5 sm:px-6 sm:py-6">
        {/* Slim header: role only (progress lives beside the avatar). */}
        <p className="truncate text-sm text-slate-400">
          Target Role: <span className="text-violet-300">{role}</span>
        </p>

        <div className="mt-4 border-t border-white/10" />

        {!started && (
          <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center">
            <h2 className="text-xl font-semibold">
              Your AI interviewer is getting ready.
            </h2>
            <p className="mt-2 text-sm text-slate-400">
              Browsers block audio until you interact, so click once to enable
              the avatar&apos;s voice and begin.
            </p>
            <button
              type="button"
              onClick={() => {
                playAvatarAudio();
                setStarted(true);
              }}
              className="mt-6 rounded-xl bg-violet-600 px-8 py-3 font-semibold text-white transition hover:bg-violet-500"
            >
              Start interview
            </button>
          </div>
        )}

        {/* Hidden audio element Simli plays the interviewer's voice through. */}
        <audio ref={avatarAudioRef} autoPlay className="hidden" />

        {/* AI interviewer portrait */}
        <section className="mt-6 flex justify-center">
          <div className="w-full max-w-[320px] sm:max-w-[340px]">
            <div className="relative aspect-[4/5] overflow-hidden rounded-3xl border border-white/10 bg-slate-900 shadow-[0_18px_50px_-20px_rgba(0,0,0,0.9)]">
              <video
                ref={avatarVideoRef}
                autoPlay
                playsInline
                className="absolute inset-0 h-full w-full object-cover object-center"
              />

              {/* Question progress, right beside the interviewer. */}
              {totalQuestions > 0 && (
                <div className="absolute right-3 top-3 z-20 flex items-center gap-1.5 rounded-full border border-white/10 bg-[#0a0f1f]/85 px-3 py-1.5 backdrop-blur">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    Question
                  </span>
                  <span className="text-sm font-bold text-white">
                    {questionNumber}
                    <span className="text-slate-500"> / {totalQuestions}</span>
                  </span>
                </div>
              )}

              {/* Slim progress bar for the whole interview. */}
              <div className="absolute inset-x-0 bottom-0 z-20 h-1 bg-white/5">
                <div
                  className="h-full bg-violet-500 transition-all duration-500"
                  style={{
                    width: `${
                      totalQuestions
                        ? (questionNumber / totalQuestions) * 100
                        : 0
                    }%`,
                  }}
                />
              </div>

              {avatarStatus !== "ready" && (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-slate-900">
                  <div className="h-9 w-9 animate-spin rounded-full border-2 border-violet-500/20 border-t-violet-400" />
                  <p className="px-6 text-center text-sm text-slate-400">
                    {avatarStatus === "error"
                      ? "Avatar unavailable - continuing with voice only"
                      : "Preparing your interviewer..."}
                  </p>
                </div>
              )}
            </div>

            <div className="mt-3 flex items-center justify-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-violet-400" />
              <span className="text-[11px] font-medium uppercase tracking-[0.2em] text-slate-400">
                AI Interviewer
              </span>

              {isSpeaking && (
                <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-violet-500/15 px-2 py-0.5 text-[11px] font-medium text-violet-300">
                  <span className="flex gap-0.5">
                    <span className="h-1 w-1 animate-bounce rounded-full bg-violet-400" />
                    <span className="h-1 w-1 animate-bounce rounded-full bg-violet-400 [animation-delay:120ms]" />
                    <span className="h-1 w-1 animate-bounce rounded-full bg-violet-400 [animation-delay:240ms]" />
                  </span>
                  Speaking
                </span>
              )}
            </div>
          </div>
        </section>

        {/* Current question */}
        <section className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-violet-300">
            Interviewer&apos;s question
          </p>

          <p className="mt-2 whitespace-pre-wrap break-words text-[15px] leading-relaxed text-slate-100">
            {currentSpeech || "The interviewer will speak shortly..."}
          </p>

          {voiceError && (
            <p className="mt-3 text-sm text-amber-400">{voiceError}</p>
          )}
        </section>

        {/* Status, answer, and microphone */}
        <section className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <div className="mb-4 flex justify-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-slate-300">
              <span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />
              {status.text}
            </span>
          </div>

          <div className="flex items-start gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-slate-400">
                Your answer
              </p>
              <p className="mt-2 whitespace-pre-wrap break-words text-[15px] leading-relaxed text-slate-100">
                {answer || "Your spoken answer will appear here..."}
              </p>
            </div>

            <div className="flex shrink-0 flex-col items-center gap-2">
              <button
                type="button"
                onClick={startListening}
                disabled={!canAnswer}
                title={canAnswer ? "Start speaking" : "Wait for your turn"}
                className={`relative grid h-16 w-16 place-items-center rounded-full border-2 text-2xl transition ${
                  canAnswer
                    ? "border-violet-500 bg-violet-600 text-white hover:bg-violet-500"
                    : micBusy
                      ? "cursor-wait border-amber-500/60 bg-amber-500/10 text-amber-300"
                      : "cursor-not-allowed border-white/10 bg-white/5 text-slate-500"
                }`}
              >
                <FaMicrophone />

                {(phase === "listening" || phase === "recording") && (
                  <span className="absolute -right-1 -top-1 flex h-3.5 w-3.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
                    <span className="relative inline-flex h-3.5 w-3.5 rounded-full bg-red-500" />
                  </span>
                )}
              </button>

              <span className="max-w-[88px] text-center text-[11px] leading-tight text-slate-400">
                {canAnswer ? "Tap to speak" : micBusy ? "Recording" : "Mic"}
              </span>
            </div>
          </div>

          {micError && (
            <p className="mt-3 text-sm text-red-400">{micError}</p>
          )}
        </section>
      </div>
    </div>
  );
}

export default InterviewRoom;
