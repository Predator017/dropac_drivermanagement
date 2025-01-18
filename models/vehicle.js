const mongoose = require('mongoose');

const VehicleSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    vehicleNumber: { type: String, required: true },
    cityOfOperations: { type: String, required: true },
    vehicleType: { type: String, required: true },
    rcImageUrl: { type: [String], required: true },
    bodyDetails: { type: String, required: true },
    bodyType: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
    // verified: { type: Boolean, default: false },
    // willDrive: { type: Boolean, required: true },
    // transportType: { type: String, required: true }
});

module.exports = mongoose.model('Vehicle', VehicleSchema);
