const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/auth");
const resumeRoutes = require("./routes/resume");
const historyRoutes = require("./routes/history");

const app = express();

app.use(cors());

app.use(express.json());

app.use(express.urlencoded({
    extended: true
}));

// Routes

app.use("/", authRoutes);

app.use("/resume", resumeRoutes);

app.use("/interviews", historyRoutes);

// Error handler

app.use((err, req, res, next) => {

    console.log(err);

    // If a middleware/controller already sent a response (e.g. 401/400),
    // sending again throws "Cannot set headers after they are sent".
    if (res.headersSent) {
        return next(err);
    }

    res.status(err.statusCode || err.status || 500).json({
        message: err.message || "Something went wrong"
    });

});

module.exports = app;