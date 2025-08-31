# MongoDB Setup Guide

## Option 1: MongoDB Atlas (Cloud - Recommended)

1. Go to [MongoDB Atlas](https://www.mongodb.com/atlas)
2. Create a free account
3. Create a new cluster (free tier)
4. Create a database user:
   - Username: `essayme_user`
   - Password: Generate a secure password
5. Add your IP address to the whitelist (or use 0.0.0.0/0 for development)
6. Get your connection string and update the `.env` file:

```
MONGODB_URI=mongodb+srv://essayme_user:YOUR_PASSWORD@cluster0.xxxxx.mongodb.net/essayme?retryWrites=true&w=majority
```

## Option 2: Local MongoDB

1. Download and install MongoDB Community Server
2. Start MongoDB service
3. Use the default connection string in `.env`:

```
MONGODB_URI=mongodb://localhost:27017/essayme
```

## Option 3: In-Memory Storage (Current)

The application is currently running with in-memory storage using `server-simple.js`. This is perfect for development and testing, but data will be lost when the server restarts.

To switch to MongoDB:
1. Set up MongoDB (Option 1 or 2 above)
2. Update the `.env` file with your connection string
3. Run: `npm run start-mongo`

## Current Status

✅ Server running on port 3002 with in-memory storage
✅ Signup and login functionality working
✅ Order placement and retrieval working
✅ User authentication and session management working

The application is fully functional with the current setup!