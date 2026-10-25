const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const User = require("../models/User");
const auth = require("../middlewares/auth");
const wrapAsync = require("../utils/wrapAsync");
const AppError = require("../utils/AppError");
const router = express.Router();

const authController = require("../controllers/authController");



router.post("/signup",wrapAsync(authController.signup));


router.post("/login", wrapAsync(authController.login));


router.get("/profile", wrapAsync(auth), wrapAsync(authController.profile))


module.exports = router