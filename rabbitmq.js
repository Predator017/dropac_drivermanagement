const amqp = require('amqplib');

let channel = null;
let connection = null;
const rabbitmqUrl = process.env.RABBITMQ_URL;

const queueNames = ["ride-requests", "outstation-ride-requests"];

const connectRabbitMQ = async () => {
  try {
    // Close existing connection if any
    if (connection) {
      try {
        await connection.close();
      } catch (err) {
        console.log("Error closing existing connection:", err.message);
      }
    }

    // Establish connection to RabbitMQ
    connection = await amqp.connect(rabbitmqUrl);
    channel = await connection.createConfirmChannel();
    console.log("Connected to RabbitMQ");

    // Assert all required queues
    for (const queue of queueNames) {
      await channel.assertQueue(queue, { durable: true });
      console.log(`Queue initialized: ${queue}`);
    }

    // Add error and close event handlers to the channel
    channel.on("error", (error) => {
      console.error("Channel error:", error);
      setTimeout(reconnectRabbitMQ, 5000);
    });

    channel.on("close", () => {
      console.log("Channel closed, reconnecting...");
      setTimeout(reconnectRabbitMQ, 5000);
    });

    // Add error and close event handlers to the connection
    connection.on("error", (error) => {
      console.error("Connection error:", error);
      setTimeout(reconnectRabbitMQ, 5000);
    });

    connection.on("close", () => {
      console.log("Connection closed, reconnecting...");
      setTimeout(reconnectRabbitMQ, 5000);
    });

  } catch (error) {
    console.error("Error connecting to RabbitMQ:", error);
    setTimeout(reconnectRabbitMQ, 5000); // Retry connection after 5 seconds
  }
};

// Function to reconnect if connection or channel is closed
const reconnectRabbitMQ = async () => {
  console.log("Attempting to reconnect to RabbitMQ...");
  try {
    await connectRabbitMQ(); // Try to reconnect
  } catch (error) {
    console.error("Failed to reconnect to RabbitMQ:", error);
    setTimeout(reconnectRabbitMQ, 5000); // Retry after 5 seconds
  }
};

// Enhanced channel getter with additional checks
const getChannel = () => {
  if (!channel || !channel.connection || channel.connection.closing || channel.connection.closed) {
    console.log("RabbitMQ channel not available, attempting to reconnect...");
    reconnectRabbitMQ();
    throw new Error("RabbitMQ channel is not initialized or closed");
  }
  return channel;
};

// Function to safely publish a message with confirmation
const publishToQueue = async (queueName, message, options = {}) => {
  try {
    const ch = getChannel();
    await ch.assertQueue(queueName, { durable: true });
    
    return new Promise((resolve, reject) => {
      ch.sendToQueue(queueName, Buffer.from(JSON.stringify(message)), {
        persistent: true,
        ...options
      }, (err, ok) => {
        if (err) {
          console.error(`Failed to publish message to ${queueName}:`, err);
          reject(err);
        } else {
          console.log(`✅ Successfully published message to ${queueName}`);
          resolve(true);
        }
      });
    });
  } catch (error) {
    console.error(`Error publishing to queue ${queueName}:`, error);
    throw error;
  }
};

module.exports = { connectRabbitMQ, getChannel, publishToQueue };
