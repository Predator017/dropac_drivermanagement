

const amqp = require('amqplib');
let channel = null;
const rabbitmqUrl = process.env.RABBITMQ_URL;

const connectRabbitMQ = async () => {
  try {
    const connection = await amqp.connect(rabbitmqUrl);
    channel = await connection.createChannel();
    console.log("Connected to RabbitMQ");

    // Ensure the "ride-requests" queue exists
    await channel.assertQueue('ride-requests', { durable: true });
  } catch (error) {
    console.error("Error connecting to RabbitMQ:", error);
    process.exit(1); // Exit process on error
  }
};

const getChannel = () => {
  if (!channel) {
    throw new Error("RabbitMQ channel is not initialized");
  }
  return channel;
};

module.exports = { connectRabbitMQ, getChannel };
