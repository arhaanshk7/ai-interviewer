import os
from typing import TypedDict, Annotated

from dotenv import load_dotenv
from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, AIMessage
from langgraph.graph import StateGraph, START, END
from langgraph.graph.message import add_messages


load_dotenv()


# ============================================================
# 1. ROLE FUNDAMENTALS
# ============================================================

ROLE_FUNDAMENTALS = {

    "Frontend Developer": [
        "HTML and CSS",
        "JavaScript fundamentals",
        "DOM and browser fundamentals",
        "React fundamentals",
        "props and state",
        "component architecture",
        "state management",
        "REST API integration",
        "authentication",
        "responsive design",
        "frontend performance",
        "testing"
    ],

    "Backend Developer": [
        "Python or Java fundamentals",
        "HTTP and REST APIs",
        "authentication and authorization",
        "SQL and databases",
        "database indexing",
        "transactions",
        "caching",
        "API design",
        "error handling",
        "concurrency",
        "deployment and cloud",
        "basic system design"
    ],

    "Full Stack Developer": [
        "HTML and CSS",
        "JavaScript fundamentals",
        "React fundamentals",
        "props and state",
        "frontend state management",
        "REST APIs",
        "backend fundamentals",
        "SQL and databases",
        "authentication and authorization",
        "API design",
        "deployment",
        "basic system design"
    ],

    "Data Scientist": [
        "Python",
        "NumPy and Pandas",
        "statistics",
        "probability",
        "data preprocessing",
        "exploratory data analysis",
        "feature engineering",
        "supervised learning",
        "unsupervised learning",
        "model evaluation",
        "overfitting and underfitting",
        "machine learning algorithms",
        "data visualization"
    ],

    "Data Analyst": [
        "Python",
        "Pandas",
        "SQL",
        "data cleaning",
        "data preprocessing",
        "exploratory data analysis",
        "statistics",
        "data visualization",
        "Excel",
        "Power BI or Tableau",
        "joins and aggregations",
        "business metrics",
        "data interpretation"
    ],

    "ML Engineer": [
        "Python",
        "NumPy and Pandas",
        "machine learning fundamentals",
        "regression and classification",
        "feature engineering",
        "model evaluation",
        "overfitting and underfitting",
        "scikit-learn",
        "deep learning fundamentals",
        "model deployment",
        "APIs",
        "MLOps",
        "model monitoring"
    ],

    "DevOps Engineer": [
        "Linux fundamentals",
        "Git and version control",
        "Docker",
        "Kubernetes",
        "CI/CD",
        "cloud computing",
        "networking",
        "infrastructure",
        "deployment",
        "monitoring and logging",
        "security",
        "automation",
        "infrastructure as code"
    ],

    "Cloud Engineer": [
        "cloud computing fundamentals",
        "AWS, Azure or GCP",
        "virtual machines",
        "storage",
        "networking",
        "VPC and subnets",
        "load balancing",
        "auto scaling",
        "IAM and access control",
        "containers",
        "serverless computing",
        "monitoring",
        "cloud security",
        "deployment"
    ],

    "AI Engineer": [
    "Python fundamentals",
    "machine learning fundamentals",
    "deep learning fundamentals",
    "neural networks",
    "transformers",
    "tokenization and embeddings",
    "LLMs",
    "prompt engineering",
    "RAG",
    "vector databases",
    "function and tool calling",
    "AI agents",
    "memory and state management",
    "fine-tuning",
    "LoRA and QLoRA",
    "hallucination and grounding",
    "evaluation and testing of LLM applications",
    "guardrails and safety",
    "AI deployment",
    "LLMOps and monitoring"
     ],

    "Cybersecurity Analyst": [
        "networking fundamentals",
        "TCP/IP",
        "firewalls",
        "authentication and authorization",
        "encryption",
        "common cyber attacks",
        "malware",
        "phishing",
        "vulnerability assessment",
        "incident response",
        "security monitoring",
        "SIEM",
        "access control",
        "security best practices"
    ],

}


def get_role_fundamentals(role: str):
    return ROLE_FUNDAMENTALS.get(role, [])


# ============================================================
# 2. INTERVIEW STATE
# ============================================================

TOTAL_PROJECT_QUESTIONS = 1
TOTAL_FUNDAMENTAL_QUESTIONS = 1


class InterviewState(TypedDict):
    role: str
    resume_text: str
    role_fundamentals: list[str]
    messages: Annotated[list, add_messages]
    stage: str
    project_count: int
    fundamental_count: int


# ============================================================
# 3. GROQ LLM
# ============================================================

llm = ChatOpenAI(
    model="openai/gpt-oss-20b",
    api_key=os.getenv("GROQ_API_KEY"),
    base_url="https://api.groq.com/openai/v1",
    temperature=0.7,
)


# ============================================================
# 4. INTERVIEWER NODE
# ============================================================

BASE_INSTRUCTIONS = """
You are a technical interviewer conducting a live mock interview for the
{role} role. Ground every question in the target role and the candidate's resume.

TARGET ROLE:
{role}

ROLE FUNDAMENTALS:
{role_fundamentals}

CANDIDATE RESUME:
{resume_text}
"""

SHARED_RULES = """
### HOW TO REPLY

Judge the candidate's previous answer, then give ONE short reaction, then ask exactly ONE next question.

- Correct answer: react positively, e.g. "That's correct." or "Excellent, that's right."
- Partially correct or incomplete answer: say so and name what was missing, e.g. "That's partially correct, but you did not mention ...".
- Wrong answer: say it clearly and simply, e.g. "That's not quite correct." or "That's not right.", then briefly mention the correct idea in one sentence.
- No answer (the message "[Candidate did not provide an answer to the previous question.]" is present): never praise the candidate. Say something like "It looks like you may not have an answer for this one." and move on.
- Keep the reaction to one short sentence, then ask the next question.

Never repeat a topic that was already covered and never ask more than one question.

CONVERSATION:
"""

GREETING_STAGE = """
### CURRENT STAGE: READINESS

This is the very start of the interview. Greet the candidate and introduce
yourself. For example:

"Hello!name(if mentioned in the resume) I'm your AI interviewer for the {role} role. We'll begin with a few
questions about your projects, followed by some role-specific technical
fundamentals. Please say, 'I am ready to start the interview' when you're ready."

Do NOT ask any interview question yet.
"""

WAITING_STAGE = """
### CURRENT STAGE: READINESS

The candidate has not clearly confirmed they are ready yet. Respond naturally
and politely ask them to confirm when they are ready. Do NOT ask an interview
question yet.
"""

PROJECT_STAGE = """
### CURRENT STAGE: PROJECT QUESTIONS ({project_asked} of {project_total})

Ask ONE question about a specific project, technology, or claim from the
candidate's resume. Ask about real things on the resume such as projects,
architecture, implementation decisions, technologies, frameworks, databases,
APIs, debugging, challenges, optimization, deployment, or design decisions.

You may ask a natural follow-up on the previous project answer when it was
weak, incomplete, or especially interesting, but only once per topic. Do not
invent anything that is not on the resume.

After all {project_total} project questions, the interview moves on to role
fundamentals. When the candidate has just confirmed readiness, skip the
evaluation and ask the first project question directly.
"""

FUNDAMENTAL_STAGE = """
### CURRENT STAGE: ROLE FUNDAMENTALS ({fundamental_asked} of {fundamental_total})

Ask ONE technical question from the ROLE FUNDAMENTALS list that is relevant to
the selected role. Do not ask about fundamentals that were already covered.
"""

# Deterministic closing. The question-forcing flow and Q&A history make the
# LLM unreliable at ending sessions (it keeps asking or answering), so the
# closing line is fixed text - guaranteed, on every interview, instant.
CLOSING_FALLBACK = (
    "This concludes our interview for the {role} role. "
    "Thank you for your time today, and best of luck with your career!"
)


def is_ready(text):
    text = (text or "").lower()
    if "not ready" in text:
        return False
    return any(
        word in text
        for word in ["ready", "yes", "start", "let's go", "lets go", "go ahead", "begin"]
    )


def ask(state: InterviewState, stage_block: str, rules: str = SHARED_RULES):
    values = {
        "role": state["role"],
        "role_fundamentals": state["role_fundamentals"],
        "resume_text": state["resume_text"],
        "project_asked": state["project_count"] + 1,
        "project_total": TOTAL_PROJECT_QUESTIONS,
        "fundamental_asked": state["fundamental_count"] + 1,
        "fundamental_total": TOTAL_FUNDAMENTAL_QUESTIONS,
    }

    prompt = (
        BASE_INSTRUCTIONS.format(**values)
        + "\n"
        + stage_block.format(**values)
        + rules
    )

    return llm.invoke([
        SystemMessage(content=prompt),
        *state["messages"],
    ])


def interviewer_node(state: InterviewState):

    # Stage 1: greeting + readiness confirmation
    if state["stage"] == "readiness":
        if not state["messages"]:
            response = ask(state, GREETING_STAGE)
            return {"messages": [response], "stage": "readiness"}

        last_message = state["messages"][-1].content or ""
        if not is_ready(last_message):
            response = ask(state, WAITING_STAGE)
            return {"messages": [response], "stage": "readiness"}

    # Stage 2: seven project / resume questions (follow-ups allowed)
    if (
        state["stage"] in ("readiness", "project")
        and state["project_count"] < TOTAL_PROJECT_QUESTIONS
    ):
        response = ask(state, PROJECT_STAGE)
        return {
            "messages": [response],
            "stage": "project",
            "project_count": state["project_count"] + 1,
        }

    # Stage 3: role fundamental questions
    if state["fundamental_count"] < TOTAL_FUNDAMENTAL_QUESTIONS:
        response = ask(state, FUNDAMENTAL_STAGE)
        return {
            "messages": [response],
            "stage": "fundamentals",
            "fundamental_count": state["fundamental_count"] + 1,
        }

    # Stage 4: closing. Always the fixed conclusion - no LLM, so it can never
    # ask another question or cut itself off.
    response = AIMessage(
        content=CLOSING_FALLBACK.format(role=state["role"])
    )
    return {"messages": [response], "stage": "done"}


# ============================================================
# 5. CREATE GRAPH
# ============================================================

graph_builder = StateGraph(InterviewState)

graph_builder.add_node("interviewer", interviewer_node)

graph_builder.add_edge(START, "interviewer")
graph_builder.add_edge("interviewer", END)


# ============================================================
# 6. COMPILE GRAPH
# ============================================================

graph = graph_builder.compile()