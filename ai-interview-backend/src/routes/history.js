const express = require("express");

const router = express.Router();

const auth = require("../middlewares/auth");
const Resume = require("../models/Resume");
const wrapAsync = require("../utils/wrapAsync");
const historyController = require("../controllers/historyController");

router.get("/history",wrapAsync(auth), wrapAsync(historyController.getHistory));

router.get("/history/:id",wrapAsync(auth),wrapAsync(historyController.getHistoryById));

module.exports = router