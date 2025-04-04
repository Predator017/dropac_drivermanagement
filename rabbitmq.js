const amqp = require('amqplib');

let channel = null;
let connection = null;  // Store connection to handle close/reconnect
const rabbitmqUrl = process.env.RABBITMQ_URL;

const queueNames = ["ride-requests", "outstation-ride-requests"];

const connectRabbitMQ = async () => {
  try {
    // Establish connection to RabbitMQ
    connection = await amqp.connect(rabbitmqUrl);
    channel = await connection.createChannel();
    console.log("Connected to RabbitMQ");

    // Assert all required queues
    for (const queue of queueNames) {
      await channel.assertQueue(queue, { durable: true });
      console.log(`Queue initialized: ${queue}`);
    }

    // Add error and close event handlers to the channel
    channel.on("error", (error) => {
      console.error("Channel error:", error);
    });

    channel.on("close", () => {
      console.log("Channel closed, reconnecting...");
      reconnectRabbitMQ();
    });

    // Add error and close event handlers to the connection
    connection.on("error", (error) => {
      console.error("Connection error:", error);
    });

    connection.on("close", () => {
      console.log("Connection closed, reconnecting...");
      reconnectRabbitMQ();
    });

  } catch (error) {
    console.error("Error connecting to RabbitMQ:", error);
    setTimeout(reconnectRabbitMQ, 5000); // Retry connection after 5 seconds
  }
};

// Function to reconnect if connection or channel is closed
const reconnectRabbitMQ = async () => {
  console.log("Attempting to reconnect to RabbitMQ...");
  await connectRabbitMQ(); // Try to reconnect
};

const getChannel = () => {
  if (!channel) {
    throw new Error("RabbitMQ channel is not initialized");
  }
  return channel;
};

module.exports = { connectRabbitMQ, getChannel };
