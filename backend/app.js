const express = require("express");
const { Pool } = require("pg");
const multer = require("multer");
const cors = require("cors");
const bodyParser = require("body-parser");
const path = require("path");
const jwt = require("jsonwebtoken");

const fs = require('fs');
require("dotenv").config();

const app = express();
const port = process.env.PORT || 4000;

// PostgreSQL connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Dynamic hostname for serving image URLs
const hostname = process.env.HOSTNAME || `http://localhost:${port}`;
const getImageURL = (filename) => `${hostname}/uploads/${filename}`;

// Multer setup for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, "uploads/");
    },
    filename: (req, file, cb) => {
        cb(null, `${Date.now()}-${file.originalname}`);
    },
});

const upload = multer({
    storage,
    fileFilter: (req, file, cb) => {
        const allowedTypes = ["image/jpeg", "image/png", "image/gif"];
        if (!allowedTypes.includes(file.mimetype)) {
            return cb(new Error("Invalid file type"), false);
        }
        cb(null, true);
    },
});

// Error handling for file uploads
app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        return res.status(400).json({ message: "File upload error", error: err.message });
    }
    next(err);
});

// JWT Authentication Middleware
const authenticate = (req, res, next) => {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ message: "Access Denied" });

    try {
        const verified = jwt.verify(token, process.env.JWT_SECRET);
        req.user = verified;
        next();
    } catch (error) {
        res.status(400).json({ message: "Invalid Token" });
    }
};

// Database Table Creation
const createSiteTable = async () => {
    const query = `
        CREATE TABLE IF NOT EXISTS sites (
            id SERIAL PRIMARY KEY,
            sitename VARCHAR(255) NOT NULL,
            sitetitle VARCHAR(255) NOT NULL,
            siteaddress TEXT NOT NULL,
            sitedescription TEXT NOT NULL,
            images TEXT NOT NULL,
            videos TEXT NOT NULL,
            category TEXT NOT NULL,
            createdat TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `;

    
    


    try {
        await pool.query(query);
        console.log("Site table created or already exists.");
    } catch (error) {
        console.error("Error creating site table:", error.message);
    }
};
createSiteTable();

// Routes

// Get all sites
app.get("/api/sites", async (req, res) => {
    try {
        const { rows } = await pool.query(
            "SELECT id, sitename, sitetitle, siteaddress, sitedescription, COALESCE(images, '') AS images, category FROM sites"
        );
        res.json({ sites: rows });
    } catch (error) {
        console.error("Error fetching sites:", error);
        res.status(500).json({ message: "Error fetching sites" });
    }
});


// Add a new site
app.post("/api/sites", upload.array("images"), async (req, res) => {
    const { sitename, sitetitle, siteaddress, sitedescription, videos, category } = req.body;
  
    try {
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ message: "No images uploaded" });
      }
  
      const imagePaths = req.files.map((file) => file.filename).join(",");
      console.log("Image paths:", imagePaths); // Log uploaded images
  
      console.log("Request body:", { sitename, sitetitle, siteaddress, sitedescription, videos, category }); // Log request body
  
      await pool.query(
        "INSERT INTO sites (sitename, sitetitle, siteaddress, sitedescription, images, videos, category) VALUES ($1, $2, $3, $4, $5, $6, $7)",
        [sitename, sitetitle, siteaddress, sitedescription, imagePaths, videos, category]
      );
  
      res.status(201).json({ message: "Site created successfully" });
    } catch (error) {
      console.error("Error adding site:", error); // Log error details
      res.status(500).json({ message: "Error adding site", error: error.message });
    }
  });
  

// Update a site
app.put("/api/sites/:id", upload.array("images"), async (req, res) => {
    const { id } = req.params;
    const { sitename, sitetitle, siteaddress, sitedescription, videos, category } = req.body;

    try {
        // Handle new image uploads
        let imagePaths = req.files.map((file) => file.filename);
        if (imagePaths.length === 0) {
            // Fetch existing images if no new images are uploaded
            const { rows } = await pool.query("SELECT images FROM sites WHERE id = $1", [id]);
            imagePaths = rows[0]?.images ? rows[0].images.split(",") : [];
        }

        // Update site information
        await pool.query(
            "UPDATE sites SET sitename = $1, sitetitle = $2, siteaddress = $3, sitedescription = $4, images = $5, videos = $6, category = $7 WHERE id = $8",
            [sitename, sitetitle, siteaddress, sitedescription, imagePaths.join(","), videos, category, id]
        );

        res.json({ message: "Site updated successfully" });
    } catch (error) {
        console.error("Error updating site:", error);
        res.status(500).json({ message: "Error updating site" });
    }
});

// Get a specific site by ID
app.get("/api/sites/:id", async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query("SELECT * FROM sites WHERE id = $1", [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ message: "Site not found" });
        }
        res.json({ site: result.rows[0] });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error fetching site data" });
    }
});


app.delete("/api/sites/:id", async (req, res) => {
    const { id } = req.params;
    try {
        // First, fetch the site to get the image filenames
        const result = await pool.query("SELECT images FROM sites WHERE id = $1", [id]);
        const site = result.rows[0];

        if (!site) {
            return res.status(404).json({ message: "Site not found" });
        }

        // If images exist, delete them from the uploads folder
        if (site.images) {
            const images = site.images.split(",");
            images.forEach((image) => {
                const imagePath = path.join(__dirname, "uploads", image.trim());
                if (fs.existsSync(imagePath)) {
                    fs.unlinkSync(imagePath); // Delete image file
                }
            });
        }

        // Now, delete the site from the database
        await pool.query("DELETE FROM sites WHERE id = $1", [id]);
        res.json({ message: "Site and images deleted successfully" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error deleting site" });
    }
});


// Default route
app.get("/", (req, res) => {
    res.send("Hello, World!");
});

// Start server
app.listen(port, () => {
    console.log(`Server running on ${hostname}`);
});
