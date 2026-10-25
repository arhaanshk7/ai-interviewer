const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const User = require("../models/User");
const AppError = require("../utils/AppError");

exports.signup = async (req,res)=>{
    const{name,email,password}=req.body;

    if(!name||!email||!password){
        throw new AppError("All fields are required",400);
    }
    
    const existingUser = await User.findOne({email});

    if(existingUser){
        throw new AppError("Email already exists",409);
    }

    const hashedPassword = await bcrypt.hash(password,10);

    const user = await User.create({
        name,
        email,
        password:hashedPassword
    });

    
    const token=jwt.sign(
        {id:user._id},
        "mysecretkey",
        {expiresIn:"7d"}
    )

    res.status(201).json({
        message:"User created successfully",
        token
    });
  
}


exports.login =async (req, res) => {

    const { email, password } = req.body;

    // Validation

    if (!email) {
        throw new AppError("Please enter your email", 400);
    }

    if (!password) {
        throw new AppError("Please enter your password", 400);
    }

    // Find user

    const user = await User.findOne({ email });

    if (!user) {
        throw new AppError("Email is not registered", 404);
    }

    // Compare password

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
        throw new AppError("Invalid password or Username", 401);
    }

    const token=jwt.sign(
        {id:user._id},
        "mysecretkey",
        {expiresIn:"7d"}
    )

    // Login success

    res.status(200).json({
        message: "Login successful",
        token
    });

}

exports.profile = async (req,res)=>{
    res.json({
        message:"profile accessed",
        user:req.user
    })
}