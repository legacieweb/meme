// Chat Theme API Endpoints
// Add these routes to your existing Express server

const express = require('express');
const { MongoClient } = require('mongodb');

// MongoDB connection (adjust connection string as needed)
const MONGODB_URI = 'mongodb://localhost:27017/essayme';
let db;

MongoClient.connect(MONGODB_URI, { useUnifiedTopology: true })
  .then(client => {
    console.log('Connected to MongoDB for Chat Themes');
    db = client.db('essayme');
  })
  .catch(error => console.error('MongoDB connection error:', error));

// Save chat settings (themes + sounds)
app.post('/student/save-chat-settings', async (req, res) => {
  try {
    const { userId, theme, customColors, sounds } = req.body;
    
    if (!userId) {
      return res.status(400).json({ 
        success: false, 
        message: 'User ID is required' 
      });
    }

    const settingsData = {
      userId: userId,
      theme: theme || 'default',
      customColors: customColors || null,
      sounds: sounds || {
        sendSound: '',
        receiveSound: '',
        volume: 50
      },
      updatedAt: new Date()
    };

    // Upsert the settings data (update if exists, insert if not)
    const result = await db.collection('chatSettings').updateOne(
      { userId: userId },
      { $set: settingsData },
      { upsert: true }
    );

    res.json({
      success: true,
      message: 'Chat settings saved successfully',
      data: result
    });

  } catch (error) {
    console.error('Error saving chat settings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to save chat settings',
      error: error.message
    });
  }
});

// Get chat settings
app.get('/student/get-chat-settings', async (req, res) => {
  try {
    const { userId } = req.query;
    
    if (!userId) {
      return res.status(400).json({ 
        success: false, 
        message: 'User ID is required' 
      });
    }

    const settingsData = await db.collection('chatSettings').findOne({ userId: userId });

    if (settingsData) {
      res.json({
        success: true,
        settings: {
          theme: settingsData.theme,
          customColors: settingsData.customColors,
          sounds: settingsData.sounds
        }
      });
    } else {
      // Return default settings if no saved settings found
      res.json({
        success: true,
        settings: {
          theme: 'default',
          customColors: null,
          sounds: {
            sendSound: '',
            receiveSound: '',
            volume: 50
          }
        }
      });
    }

  } catch (error) {
    console.error('Error getting chat settings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get chat settings',
      error: error.message
    });
  }
});

// Legacy endpoints for backward compatibility
app.post('/student/save-chat-theme', async (req, res) => {
  // Redirect to new endpoint
  req.body.sounds = req.body.sounds || { sendSound: '', receiveSound: '', volume: 50 };
  return app.post('/student/save-chat-settings')(req, res);
});

app.get('/student/get-chat-theme', async (req, res) => {
  try {
    const { userId } = req.query;
    const settingsData = await db.collection('chatSettings').findOne({ userId: userId });

    if (settingsData) {
      res.json({
        success: true,
        theme: {
          theme: settingsData.theme,
          customColors: settingsData.customColors
        }
      });
    } else {
      res.json({
        success: true,
        theme: {
          theme: 'default',
          customColors: null
        }
      });
    }
  } catch (error) {
    console.error('Error getting chat theme:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get chat theme',
      error: error.message
    });
  }
});

// Get all chat settings (for admin or analytics)
app.get('/admin/chat-settings', async (req, res) => {
  try {
    const settings = await db.collection('chatSettings').find({}).toArray();
    
    // Get theme usage statistics
    const themeStats = {};
    const soundStats = {
      sendSounds: {},
      receiveSounds: {},
      averageVolume: 0
    };
    
    let totalVolume = 0;
    let volumeCount = 0;
    
    settings.forEach(setting => {
      // Theme stats
      const themeName = setting.theme;
      themeStats[themeName] = (themeStats[themeName] || 0) + 1;
      
      // Sound stats
      if (setting.sounds) {
        if (setting.sounds.sendSound) {
          soundStats.sendSounds[setting.sounds.sendSound] = 
            (soundStats.sendSounds[setting.sounds.sendSound] || 0) + 1;
        }
        if (setting.sounds.receiveSound) {
          soundStats.receiveSounds[setting.sounds.receiveSound] = 
            (soundStats.receiveSounds[setting.sounds.receiveSound] || 0) + 1;
        }
        if (setting.sounds.volume !== undefined) {
          totalVolume += setting.sounds.volume;
          volumeCount++;
        }
      }
    });
    
    soundStats.averageVolume = volumeCount > 0 ? Math.round(totalVolume / volumeCount) : 50;

    res.json({
      success: true,
      totalUsers: settings.length,
      themeStats: themeStats,
      soundStats: soundStats,
      settings: settings
    });

  } catch (error) {
    console.error('Error getting chat settings statistics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get chat settings statistics',
      error: error.message
    });
  }
});

// Legacy admin endpoint
app.get('/admin/chat-themes', async (req, res) => {
  return app.get('/admin/chat-settings')(req, res);
});

module.exports = {
  // Export functions if needed for testing
  saveChatSettings: async (userId, theme, customColors, sounds) => {
    const settingsData = {
      userId: userId,
      theme: theme || 'default',
      customColors: customColors || null,
      sounds: sounds || {
        sendSound: '',
        receiveSound: '',
        volume: 50
      },
      updatedAt: new Date()
    };
    
    return await db.collection('chatSettings').updateOne(
      { userId: userId },
      { $set: settingsData },
      { upsert: true }
    );
  },
  
  getChatSettings: async (userId) => {
    return await db.collection('chatSettings').findOne({ userId: userId });
  },
  
  // Legacy functions
  saveChatTheme: async (userId, theme, customColors) => {
    return await module.exports.saveChatSettings(userId, theme, customColors, null);
  },
  
  getChatTheme: async (userId) => {
    const settings = await db.collection('chatSettings').findOne({ userId: userId });
    return settings ? {
      userId: settings.userId,
      theme: settings.theme,
      customColors: settings.customColors,
      updatedAt: settings.updatedAt
    } : null;
  }
};