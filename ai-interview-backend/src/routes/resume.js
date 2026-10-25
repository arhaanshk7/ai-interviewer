const express = require("express");

const router = express.Router();

const auth = require("../middlewares/auth");
const upload = require("../middlewares/multer");
const wrapAsync = require("../utils/wrapAsync");

const resumeController = require("../controllers/resumeController");


router.post("/upload", wrapAsync(auth),upload.single("resume"), wrapAsync(resumeController.upload));

module.exports = router