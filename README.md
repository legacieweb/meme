# EssayMe - Assignment Services Platform

A full-stack web application for assignment services with user authentication, order management, and student dashboard.

## 🚀 Features

- **User Authentication**: Secure signup and login with password hashing
- **Student Dashboard**: Personalized dashboard with order tracking
- **Order Management**: Place and track assignment orders
- **Responsive Design**: Mobile-friendly interface using Tailwind CSS
- **Real-time Updates**: Dynamic content loading and updates

## 🛠️ Technology Stack

### Backend
- **Node.js** with Express.js
- **MongoDB** with Mongoose (or in-memory storage for development)
- **bcrypt** for password hashing
- **CORS** enabled for cross-origin requests

### Frontend
- **HTML5** with semantic markup
- **Tailwind CSS** for styling
- **Vanilla JavaScript** for interactivity
- **Font Awesome** for icons

## 📦 Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd essayme
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   - Copy `.env.example` to `.env`
   - Update MongoDB connection string if needed

4. **Start the server**
   ```bash
   # For in-memory storage (development)
   npm start
   
   # For MongoDB (production)
   npm run start-mongo
   ```

5. **Access the application**
   - Open your browser and go to `http://localhost:3002`

## 🗂️ Project Structure

```
essayme/
├── index.html              # Main landing page
├── student.html            # Student dashboard
├── place-order.html        # Order placement form
├── server.js               # MongoDB server
├── server-simple.js        # In-memory server (current)
├── package.json            # Dependencies and scripts
├── .env                    # Environment variables
├── README.md               # This file
├── MONGODB_SETUP.md        # Database setup guide
└── uploads/                # File upload directory
```

## 🔧 API Endpoints

### Authentication
- `POST /signup` - User registration
- `POST /login` - User login
- `GET /user/:userId` - Get user profile

### Orders
- `POST /place-order` - Place new order
- `GET /orders/:userId` - Get user orders

## 💾 Database Schema

### User Model
```javascript
{
  id: Number,
  name: String,
  email: String (unique),
  password: String (hashed),
  role: String (default: 'student'),
  createdAt: Date,
  lastLogin: Date
}
```

### Order Model
```javascript
{
  id: Number,
  userId: Number,
  orderType: String,
  subject: String,
  deadline: Date,
  pages: Number,
  description: String,
  status: String (default: 'pending'),
  createdAt: Date
}
```

## 🔐 Security Features

- Password hashing with bcrypt
- Input validation and sanitization
- CORS protection
- Error handling and logging

## 🎯 Usage

### For Students
1. **Sign Up**: Create a new account with name, email, and password
2. **Login**: Access your dashboard with email and password
3. **Place Orders**: Submit assignment details through the order form
4. **Track Progress**: Monitor order status in the dashboard
5. **Manage Profile**: Update personal information

### For Development
1. **Testing**: Use `test.html` for API testing
2. **Debugging**: Check console logs for detailed error information
3. **Database**: Switch between in-memory and MongoDB storage

## 🚦 Current Status

✅ **Authentication System**: Fully functional signup/login  
✅ **User Dashboard**: Complete with profile and order management  
✅ **Order System**: Place and track orders  
✅ **Responsive Design**: Works on all devices  
✅ **Error Handling**: Comprehensive error management  
✅ **Session Management**: Persistent user sessions  

## 🔄 Development vs Production

### Development (Current)
- Uses `server-simple.js` with in-memory storage
- Data resets on server restart
- Perfect for testing and development
- No database setup required

### Production
- Uses `server.js` with MongoDB
- Persistent data storage
- Requires MongoDB setup
- Scalable and production-ready

## 📝 Environment Variables

```env
# Database
MONGODB_URI=mongodb://localhost:27017/essayme

# Server
PORT=3002
NODE_ENV=development
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📄 License

This project is licensed under the ISC License.

## 🆘 Support

For issues and questions:
1. Check the console logs for errors
2. Verify server is running on port 3002
3. Ensure all dependencies are installed
4. Review the MongoDB setup guide if using database storage

---

**Happy Coding! 🎉**