const mongoose = require('mongoose');

const DocumentSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    documentType: { type: String, required: true },
    s3Url1: { type: String },
    s3Url2: { type: String },
    // willDrive: { type: Boolean },
    // transportType: { type: String },
    verified: { type: String, default: 'pending' },
    paymentdone: { type: Boolean, default: false },
});

module.exports = mongoose.model('Document', DocumentSchema);
