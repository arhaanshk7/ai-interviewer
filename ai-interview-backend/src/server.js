require("dotenv").config({
  // .env lives at the repo root, one level above ai-interview-backend/src.
  // Resolving from __dirname works no matter what directory the server is started from.
  path: require("path").join(__dirname, "..", ".env"),
});
const app = require("./app");
const connectDB = require("./config/db");

const PORT = 5000;

connectDB();

app.listen(PORT,()=>{
    console.log("server is listening on port 5000");
})