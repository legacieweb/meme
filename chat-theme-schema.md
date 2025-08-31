# Chat Customization MongoDB Schema

## Collection: `chatSettings`

This collection stores the complete chat customization preferences for each student, including themes and sound settings.

### Document Structure

```javascript
{
  _id: ObjectId("..."),
  userId: "student123",           // Student's user ID
  theme: "ocean",                 // Theme name: "default", "ocean", "sunset", "forest", "midnight", "candy", "cyber", "custom"
  customColors: {                 // Only present when theme is "custom"
    studentBg: "#3b82f6",         // Student message background color
    tutorBg: "#f3f4f6"           // Tutor message background color
  },
  sounds: {                       // Sound preferences
    sendSound: "send.mp3",        // Send message sound file
    receiveSound: "receive.mp3",  // Receive message sound file
    volume: 75                    // Volume level (0-100)
  },
  updatedAt: ISODate("2024-01-15T10:30:00Z")  // Last update timestamp
}
```

### Available Themes

1. **default** - Classic Blue
   - Student: Blue background (#3b82f6), white text
   - Tutor: Light gray background (#f3f4f6), dark text

2. **ocean** - Ocean Waves
   - Student: Blue-purple gradient, white text
   - Tutor: Light blue background, blue text

3. **sunset** - Sunset Glow
   - Student: Pink gradient, gray text
   - Tutor: Orange background, orange text

4. **forest** - Forest Green
   - Student: Green gradient, white text
   - Tutor: Light green background, green text

5. **midnight** - Midnight Dark
   - Student: Dark gradient, white text
   - Tutor: Dark gray background, light text

6. **candy** - Sweet Candy
   - Student: Red-yellow gradient, white text
   - Tutor: Pink background, pink text

7. **cyber** - Cyber Neon
   - Student: Cyan gradient, white text
   - Tutor: Dark background, cyan text
   - Special: Sharp corners, neon glow effects

8. **custom** - User-defined colors
   - Student: User-selected background color
   - Tutor: User-selected background color
   - Text colors automatically calculated for contrast

### Available Sound Files

**Send Message Sounds:**
- `send.mp3` - Default Send
- `tap-notification-180637.mp3` - Tap Sound
- `system-notification-02-352442.mp3` - System Sound

**Receive Message Sounds:**
- `receive.mp3` - Default Receive
- `notification-bell-sound-1-376885.mp3` - Bell Sound
- `notification-ping-335500.mp3` - Ping Sound
- `bright-notification-352449.mp3` - Bright Notification
- `new-notification-013-363676.mp3` - New Notification

### Indexes

```javascript
// Create index on userId for fast lookups
db.chatSettings.createIndex({ "userId": 1 }, { unique: true })

// Create index on theme for analytics
db.chatSettings.createIndex({ "theme": 1 })

// Create index on sounds for analytics
db.chatSettings.createIndex({ "sounds.sendSound": 1 })
db.chatSettings.createIndex({ "sounds.receiveSound": 1 })

// Create index on updatedAt for cleanup/analytics
db.chatSettings.createIndex({ "updatedAt": 1 })
```

### Sample Queries

```javascript
// Get user's settings
db.chatSettings.findOne({ userId: "student123" })

// Get theme usage statistics
db.chatSettings.aggregate([
  { $group: { _id: "$theme", count: { $sum: 1 } } },
  { $sort: { count: -1 } }
])

// Get sound usage statistics
db.chatSettings.aggregate([
  { $group: { _id: "$sounds.sendSound", count: { $sum: 1 } } },
  { $sort: { count: -1 } }
])

// Get users with custom themes
db.chatSettings.find({ theme: "custom" })

// Get users with sounds enabled
db.chatSettings.find({ 
  $or: [
    { "sounds.sendSound": { $ne: "" } },
    { "sounds.receiveSound": { $ne: "" } }
  ]
})

// Get average volume level
db.chatSettings.aggregate([
  { $group: { _id: null, avgVolume: { $avg: "$sounds.volume" } } }
])

// Clean up old settings (older than 1 year)
db.chatSettings.deleteMany({ 
  updatedAt: { $lt: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000) } 
})
```

### API Endpoints

**New Endpoints:**
- `POST /student/save-chat-settings` - Save user's complete chat settings
- `GET /student/get-chat-settings?userId=...` - Get user's saved settings
- `GET /admin/chat-settings` - Get complete settings statistics (admin only)

**Legacy Endpoints (for backward compatibility):**
- `POST /student/save-chat-theme` - Save user's theme preference
- `GET /student/get-chat-theme?userId=...` - Get user's saved theme
- `GET /admin/chat-themes` - Get theme statistics (admin only)

### Features

- **Persistence**: Themes are saved to MongoDB and persist across sessions
- **Real-time Preview**: Live preview in the settings modal
- **Custom Colors**: Users can create their own color combinations
- **Responsive**: Works on all screen sizes
- **Animations**: Smooth transitions and hover effects
- **Accessibility**: Automatic contrast calculation for readability
- **Analytics**: Track popular themes for insights