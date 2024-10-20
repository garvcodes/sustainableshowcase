const express = require("express");
const multer = require("multer");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const fs = require("fs");
const path = require("path");
const cors = require('cors');
const app = express();
const { GoogleAIFileManager } = require("@google/generative-ai/server");
const { GoogleGenerativeAI } = require("@google/generative-ai");

dotenv.config();

// Enable CORS for all routes
app.use(cors());

// MongoDB connection
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("Connected to MongoDB"))
  .catch((error) => console.log("MongoDB connection error:", error));




// Multer setup for file storage
const storage = multer.memoryStorage();
const upload = multer({ storage });


// MongoDB schema for User and image
const userSchema = new mongoose.Schema({
  email: String,
  image: Buffer,
  contentType: String,
  geminiUri: String, // New field to store Gemini URI
});

const User = mongoose.model("User", userSchema);

// Google AI setup
const fileManager = new GoogleAIFileManager(process.env.API_KEY);
const genAI = new GoogleGenerativeAI(process.env.API_KEY);

// Route to handle file upload
app.post("/upload", upload.single("image"), async (req, res) => {
  try {

    const { email } = req.body;
    const image = req.file;

    if (!email || !image) {
      return res.status(400).send("Email and image are required");
    }

    // Create a new user with the uploaded image
    const newUser = new User({
      email,
      image: image.buffer,
      contentType: image.mimetype,
    });

    await newUser.save();

    // Create a temporary file path
    const tempFilePath = path.join(__dirname, "uploads", `${Date.now()}-${image.originalname}`);
    
    // Write the image buffer to the temporary file
    fs.writeFileSync(tempFilePath, image.buffer);

    // Upload to Gemini
    const uploadResult = await fileManager.uploadFile(tempFilePath, {
      mimeType: image.mimetype,
      displayName: `${email}-image`,
    });

    console.log(`Uploaded file ${uploadResult.file.displayName} as: ${uploadResult.file.uri} `);

    // Store Gemini URI in the user record
    newUser.geminiUri = uploadResult.file.uri;
    await newUser.save();

    // read file
    const pepsico_product_list = fs.readFileSync('uploads/pepsico.txt', 'utf-8')

    // Generate content using the uploaded image
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const result = await model.generateContent([
      'Here is a full list of Pepsico products:\n ${pepsico_product_list}. Is the object in the image a Pepsico product? If not, reply \'This is not a Pepsico product, please take a photo of a Pepsico product!\' If it is a pepsico product, describe how many and what brands they are. Then, give me an easy-to-follow instruction for upcycling projects with this object. the project has to be creative, environment-friendly, and fun to make. Give me only one but a different one each time',
      {
        fileData: {
          fileUri: uploadResult.file.uri,
          mimeType: uploadResult.file.mimeType,
        },
      },
    ]);

    console.log(JSON.stringify(result, null, 2))

    // Clean up the temporary file after upload
    fs.unlinkSync(tempFilePath); // Remove the temporary file

    res.status(200).json({
      message: "Image uploaded successfully!",
      geminiResponse: result.response.text(),
      geminiUri: uploadResult.file.uri,
    });
  } catch (error) {
    console.error("Error during image upload or generation:", error);
    res.status(500).send("Error uploading image");
  }
});


app.post("/upload-creation", upload.single("image"), async (req, res) => {
  try {
    const { email } = req.body;
    const image = req.file;

    if (!email || !image) {
      return res.status(400).send("Email and image are required");
    }

    // Create a new user with the uploaded image
    const newUser = new User({
      email,
      image: image.buffer, // Store the image buffer
      contentType: image.mimetype, // Store the MIME type
    });

    await newUser.save(); // Save the user with the image

    return res.status(201).send("User and image saved successfully");
  } catch (error) {
    console.error("Error saving user or image", error);
    return res.status(500).send("Internal server error");
  }
});


app.get("/leaderboard", async (req, res) => {
  try {
    // Fetch all users with their images sorted by the most recent upload
    const users = await User.aggregate([
      {
        $project: {
          email: 1,
          image: 1,
          contentType: 1,
          geminiUri: 1,
        },
      },
    ]);

    // Convert binary images to base64 and include them in the response
    const usersWithImages = users.map((user) => ({
      email: user.email,
      contentType: user.contentType,
      image: user.image ? user.image.toString('base64') : null, // Convert binary image to base64
      geminiUri: user.geminiUri,
    }));

    res.json(usersWithImages);
  } catch (error) {
    console.error("Error fetching leaderboard", error);
    res.status(500).send("Error fetching leaderboard");
  }
});




// Start server
const port = process.env.PORT || 5050;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
