const jwt = require("jsonwebtoken");
const User = require("../models/User");

const auth = async (req,res,next)=>{

    const token = req.headers.authorization?.split(" ")[1];

    if(!token){
        return res.status(401).json({
            message:"Please login first"
        });
    }


    let decoded;
    try {
        decoded = jwt.verify(
            token,
            "mysecretkey"
        );
    } catch (err) {
        // Invalid or expired token -> clean 401 instead of an unhandled throw.
        return res.status(401).json({
            message: "Invalid or expired token. Please login again.",
        });
    }


    const user = await User.findById(decoded.id);


    req.user = user;

    next();

}


module.exports = auth;