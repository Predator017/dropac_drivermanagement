const mongoose = require('mongoose');
const vehicle = require('./vehicle');

const tripSchema = new mongoose.Schema({
    driverId: { type: String },
    vehicleId: { type: String },
    customerId: { type: String, required: true },
    pickupCustomerDetails: {
        name: { type: String, required: true },
        mobile: { type: String, required: true },
    },
    pickupLocation: {
        type: { type: String, enum: ['Point'], required: true },
        coordinates: { type: [Number], required: true },
        address: { type: String, required: true }
    },
    dropoffLocations: [{
        dropoffCustomerDetails: {
            name: { type: String, required: true },
            mobile: { type: String, required: true },
            destinationReached: { type: Boolean, default: false }
        },
        dropoffLocation: {
            type: { type: String, enum: ['Point'], required: true },
            coordinates: { type: [Number], required: true },
            address: { type: String, required: true }
        }
    }],
    distance: { type: Number, required: true },
    duration: { type: Number, required: true },
    fare: { type: Number, required: true },
    // fare20percent: { type: Number },
    paymentStatus: { type: Boolean, default: false },
    status: { type: String, default: 'pending' },
    createdAt: { type: Date, default: Date.now },
    rating: { type: Number, default: 0 },
    cancellationReason: { type: String },
    vehicleType: { type: String },
    tripOtp: { type: String },
});
tripSchema.index({ pickupLocation: '2dsphere' });
tripSchema.index({ 'dropoffLocations.dropoffLocation': '2dsphere' });

// tripSchema.pre('save', function(next) {
//     if (this.isModified('fare')) {
//         this.fare20percent = this.fare * 0.2;
//     }
//     next();
// });

module.exports = mongoose.model('Trip', tripSchema);