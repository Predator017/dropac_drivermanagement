const express = require('express');
const multer = require('multer');
const multerS3 = require('multer-s3');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const Vehicle = require('../models/vehicle');
const Document = require('../models/Document');
const router = express.Router();

// Initialize the S3 client
const s3Client = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY,
        secretAccessKey: process.env.AWS_SECRET_KEY
    }
});

// Configure multer to use S3 for file storage
const upload = multer({
    storage: multerS3({
        s3: s3Client,
        bucket: process.env.AWS_BUCKET_NAME,
        // acl: 'public-read', // You can set it to 'private' if needed
        metadata: (req, file, cb) => {
            cb(null, { fieldName: file.fieldname });
        },
        key: (req, file, cb) => {
            cb(null, Date.now().toString() + '-' + file.originalname);
        }
    })
});

// Upload a Vehicle RC image along with vehicle details
const uploadVehicleRC = upload.array('vehicleRC', 2);

router.post('/upload', uploadVehicleRC, async (req, res) => {
    try {
        const { userId, vehicleNumber, cityOfOperations, vehicleType, bodyType, bodyDetails } = req.body;

        // Create a new vehicle entry in the database
        const newVehicle = new Vehicle({
            userId,
            vehicleNumber,
            cityOfOperations,
            vehicleType,
            bodyType,
            bodyDetails,
            rcImageUrl: req.files.map(file => file.location) // Array of S3 URLs of the uploaded RC images
        });

        // Save the new vehicle details to the database
        await newVehicle.save();

        res.status(200).json({
            message: 'Vehicle details and RC image uploaded successfully',
            vehicle: newVehicle
        });
    } catch (error) {
        console.log(error);
        res.status(500).json({ error: 'Vehicle upload failed', details: error.message });
    }
});


// Endpoint to get vehicle details
router.get('/:userId', async (req, res) => {
    try {
        const vehicle = await Vehicle.findOne({ userId: req.params.userId });
        if (!vehicle) return res.status(404).json({ error: 'Vehicle details not found' });
        res.status(200).json(vehicle);
    } catch (error) {
        res.status(500).json({ error: 'Failed to retrieve vehicle details', details: error.message });
    }
});

module.exports = router;

// create a new api to verify the vehicle details by support team and update the status of the vehicle

router.put('/verify/:vehicleId', async (req, res) => {
    try {
        // Extract vehicleId from params and verified status from body
        // const vehicleId = req.params.vehicleId;
        const { verified } = req.body;

        // Find the document by ID
        const document = await Document.findOne({ userId: req.params.vehicleId });

        // If document not found, return 404
        if (!document) return res.status(404).json({ error: 'Vehicle not found' });

        // Update the verified status
        document.verified = verified;

        // Save the updated document
        await document.save();

        // Respond with success message and the updated document
        res.status(200).json({
            message: 'Vehicle details verified successfully',
            document
        });
    } catch (error) {
        // Handle errors
        res.status(500).json({
            error: 'Failed to verify vehicle details',
            details: error.message
        });
    }
});


router.put('/paymentdone/:vehicleId', async (req, res) => {
    try {
        // Find the document associated with the vehicleId
        const document = await Document.findOne({ userId: req.params.vehicleId });
        if (!document) return res.status(404).json({ error: 'Document not found' });

        // Update the paymentdone status
        document.paymentdone = true;
        await document.save();

        // Respond with a success message and updated document
        res.status(200).json({ message: 'Payment done successfully', document });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update payment status', details: error.message });
    }
});

