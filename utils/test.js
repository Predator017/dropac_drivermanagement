// Helper function to convert degrees to radians
function deg2rad(deg) {
    return deg * (Math.PI / 180);
}

// Reference location [17.533495, 78.391820]
const referenceLat = 17.533495;
const referenceLon = 78.391820;

// Array of user locations with swapped latitudes and longitudes
const userLocations = [
    { userId: "user1", userLocation: [78.4747, 17.3616] },  // Charminar
    { userId: "user2", userLocation: [78.4012, 17.3833] },  // Golconda Fort
    { userId: "user3", userLocation: [78.4899, 17.4266] },  // Hussain Sagar Lake
    { userId: "user4", userLocation: [78.4024, 17.3675] },  // Qutub Shahi Tombs
    { userId: "user5", userLocation: [78.4050, 17.2233] },  // Ramoji Film City
    { userId: "user6", userLocation: [78.4750, 17.4121] },  // Birla Mandir
    { userId: "user7", userLocation: [78.4713, 17.3589] },  // Salar Jung Museum
    { userId: "user8", userLocation: [78.4723, 17.3571] },  // Nehru Zoological Park
    { userId: "user9", userLocation: [78.4745, 17.3629] },  // Laad Bazaar
    { userId: "user10", userLocation: [78.3779, 17.4449] }  // Shilparamam
];

// Radius of the Earth in km
const R = 6371;

// Loop through each user location to calculate the distance
userLocations.forEach(user => {
    const [userLon, userLat] = user.userLocation; // Swap coordinates (longitude, latitude)
    
    const dLat = deg2rad(userLat - referenceLat); // Difference in latitudes
    const dLon = deg2rad(userLon - referenceLon); // Difference in longitudes
    
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(deg2rad(referenceLat)) * Math.cos(deg2rad(userLat)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    
    const distance = R * c; // Distance in km
    
    console.log(`Distance from ${user.userId} to reference location: ${distance.toFixed(2)} km`);
});
