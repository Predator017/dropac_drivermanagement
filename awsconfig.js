// // Load AWS SDK and configure S3
// const AWS = require('aws-sdk');
// const multer = require('multer');
// const multerS3 = require('multer-s3');

// // Initialize the S3 instance
// const s3 = new AWS.S3({
//   accessKeyId: process.env.AWS_ACCESS_KEY,   // Set in environment variables
//   secretAccessKey: process.env.AWS_SECRET_KEY,  // Set in environment variables
//   region: process.env.AWS_REGION // e.g., 'us-east-1'
// });

// // Ensure the bucket is created and exists in your AWS console
// const bucketName = process.env.AWS_BUCKET_NAME;  // Your S3 bucket name

// // Configure multer to use S3 for file storage
// const upload = multer({
//     storage: multerS3({
//       s3: s3,
//       bucket: bucketName,
//       acl: 'public-read',  // Make the files public. You can change this to private if needed.
//       metadata: (req, file, cb) => {
//         cb(null, { fieldName: file.fieldname });
//       },
//       key: (req, file, cb) => {
//         cb(null, Date.now().toString() + '-' + file.originalname); // Unique file name
//       }
//     })
//   });
  