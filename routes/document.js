const express = require('express');
const multer = require('multer');
const Driver = require('../models/driver');
const sharp = require('sharp');
const mongoose = require('mongoose');
const { GridFSBucket } = require('mongodb');
const router = express.Router();

// Connect to MongoDB
const mongoURI = process.env.MONGODB_URI ;
const conn = mongoose.createConnection(mongoURI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
});

let gfs;
let gridFSBucket;

// Initialize GridFS
conn.once('open', () => {
    gridFSBucket = new GridFSBucket(conn.db, { bucketName: 'uploads' });
    gfs = gridFSBucket;
    console.log('Connected to GridFS');
});

// Configure multer for memory storage
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }, // Limit upload size to 5MB
});

// Endpoint to upload and compress an image
router.post('/upload-image', upload.single('image'), async (req, res) => {
    try {
        const file = req.file;

        if (!file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const { driverId, imageName } = req.body;

        if (!driverId || !imageName) {
            return res.status(400).json({ error: 'driverId and imageName are required' });
        }

        // Generate a unique identifier for the file
        const uniqueFileName = `${driverId}_${imageName}`;

        // Check if a file with the same identifier already exists
        const existingFile = await gfs.find({ filename: uniqueFileName }).toArray();

        if (existingFile.length > 0) {
            // Delete the existing file
            await gfs.delete(existingFile[0]._id);
        }

        // Compress the image to not exceed 0.5MB
        const compressedImageBuffer = await sharp(file.buffer)
            .resize({ width: 800 }) // Resize to max width of 800px
            .jpeg({ quality: 70 }) // Compress with 70% quality
            .toBuffer();

        if (compressedImageBuffer.length > 500 * 1024) {
            return res.status(400).json({ error: 'Image compression failed to meet size requirement' });
        }

        // Upload the compressed image to GridFS
        const uploadStream = gridFSBucket.openUploadStream(uniqueFileName, {
            contentType: 'image/jpeg',
        });

        uploadStream.end(compressedImageBuffer);

        uploadStream.on('finish', async () => {
            const fileUrl = `${req.protocol}://${req.get('host')}/api/documents/file/${uploadStream.id}`;

            // Find the driver by ID
            const driver = await Driver.findById(driverId);
            if (!driver) {
                return res.status(404).json({ message: 'Driver not found' });
            }

            // Update the appropriate field in the driver document
            switch (imageName) {
                case "aadhar_front":
                    driver.aadhar_front = fileUrl;
                    break;
                case "aadhar_back":
                    driver.aadhar_back = fileUrl;
                    break;
                case "pan_front":
                    driver.pan_front = fileUrl;
                    break;
                case "pan_back":
                    driver.pan_back = fileUrl;
                    break;
                case "DL_front":
                    driver.DL_front = fileUrl;
                    break;
                case "DL_back":
                    driver.DL_back = fileUrl;
                    break;
                case "selfie":
                    driver.selfie = fileUrl;
                    break;
                default:
                    return res.status(400).json({ error: 'Invalid imageName value' });
            }

            // Save the updated driver document
            await driver.save();

            res.status(200).json({
                message: 'Image uploaded successfully',
            });
        });

        uploadStream.on('error', (error) => {
            throw error;
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to upload and compress image', details: error.message });
    }
});


// Endpoint to retrieve an image by ID
router.get('/file/:id', async (req, res) => {
    try {
        const fileId = new mongoose.Types.ObjectId(req.params.id);
        const downloadStream = gridFSBucket.openDownloadStream(fileId);

        downloadStream.on('data', (chunk) => {
            res.write(chunk);
        });

        downloadStream.on('end', () => {
            res.end();
        });

        downloadStream.on('error', (error) => {
            res.status(404).json({ error: 'File not found', details: error.message });
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to retrieve image', details: error.message });
    }
});

module.exports = router;
