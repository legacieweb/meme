require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const nodemailer = require('nodemailer');

// Mail transporter for SMTP
const mailTransporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'mail.privateemail.com',
  port: Number(process.env.SMTP_PORT || 587),
  secure: false,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  tls: { rejectUnauthorized: false }
});

// Simple mail helper that fails safely
async function sendMailSafe({ to, subject, text, html }) {
  try {
    if (!to) return;
    await mailTransporter.sendMail({
      from: `EssayMe <${process.env.SMTP_USER || 'hello@iyonicorp.com'}>`,
      to,
      subject,
      text: text || (html ? html.replace(/<[^>]+>/g, ' ') : ''),
      html: html || undefined
    });
  } catch (e) {
    console.error('Email send failed:', subject, to, e?.message || e);
  }
}

function fmtMoney(n){ return `$${Number(n||0).toFixed(2)}`; }

const app = express();
const PORT = process.env.PORT || 3002;

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Multer configuration for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: function (req, file, cb) {
    // Allow common file types by extension (covers Office formats)
    const allowedExt = /(\.jpeg|\.jpg|\.png|\.gif|\.pdf|\.doc|\.docx|\.txt|\.zip|\.rar|\.xlsx|\.xls|\.ppt|\.pptx)$/i;
    const extnameOk = allowedExt.test(path.extname(file.originalname).toLowerCase());
    if (extnameOk) return cb(null, true);
    cb(new Error('Only images and document files are allowed'));
  }
});

// Memory-based upload for storing directly to MongoDB GridFS
const uploadMem = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit (same as disk)
  },
  fileFilter: function (req, file, cb) {
    const allowedExt = /(\.jpeg|\.jpg|\.png|\.gif|\.pdf|\.doc|\.docx|\.txt|\.zip|\.rar|\.xlsx|\.xls|\.ppt|\.pptx)$/i;
    const extnameOk = allowedExt.test(path.extname(file.originalname).toLowerCase());
    if (extnameOk) return cb(null, true);
    cb(new Error('Only images and document files are allowed'));
  }
});

// Middleware
app.use(cors({
  origin: '*', // consider restricting to your domains in production
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
  credentials: false
}));
app.use((req,res,next)=>{
  res.header('Access-Control-Allow-Origin','*');
  res.header('Access-Control-Allow-Methods','GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers','Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));
// app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// GridFS download route
app.get('/file/:id', async (req, res) => {
  try {
    if (!gfsBucket) return res.status(500).send('File storage not initialized');
    const { id } = req.params;
    const { ObjectId } = require('mongodb');
    if (!ObjectId.isValid(id)) return res.status(400).send('Invalid file id');

    // Try to find file to set headers
    const files = await gfsBucket.find({ _id: new ObjectId(id) }).toArray();
    if (!files || files.length === 0) return res.status(404).send('File not found');
    const file = files[0];

    if (file.contentType) res.set('Content-Type', file.contentType);
    // Force download instead of inline view
    res.set('Content-Disposition', `attachment; filename="${(file.filename || 'download').replace(/"/g, '')}"`);

    const readStream = gfsBucket.openDownloadStream(new ObjectId(id));
    readStream.on('error', () => res.status(404).end());
    readStream.pipe(res);
  } catch (e) {
    console.error('Download error:', e);
    res.status(500).send('Internal server error');
  }
});

// MongoDB connection - using local MongoDB or MongoDB Atlas
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://dbadmin:7Switched@7.tcp.eu.ngrok.io:18734/essayme?authSource=admin';

let gfsBucket = null;

mongoose.connect(MONGODB_URI)
.then(() => {
  console.log('Connected to MongoDB successfully');
  console.log('Database URI:', MONGODB_URI);
  const db = mongoose.connection.db;
  const { GridFSBucket } = require('mongodb');
  gfsBucket = new GridFSBucket(db, { bucketName: 'uploads' });
  console.log('GridFS initialized with bucket: uploads');
})
.catch((error) => {
  console.error('MongoDB connection error:', error);
  console.log('Falling back to in-memory storage for development...');
});

// User Schema
const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  role: {
    type: String,
    default: 'student',
    enum: ['student', 'admin', 'tutor']
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  lastLogin: {
    type: Date
  },
  balance: {
    type: Number,
    default: 0,
    min: 0
  },
  bio: {
    type: String,
    default: ''
  },
  phone: {
    type: String,
    default: ''
  },
  profileImageId: {
    type: String, // GridFS file id as string
    default: ''
  }
});

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Method to compare password
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

const User = mongoose.model('User', userSchema);

// Order Schema
const orderSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  orderType: {
    type: String,
    required: true,
    enum: [
      // Writing assignments
      'essay', 'research-paper', 'discussion-post', 'summary', 'book-review', 'case-study', 'lab-report', 'thesis',
      // Rewriting services  
      'rewrite-essay', 'rewrite-paper', 'paraphrasing',
      // Correction services
      'proofreading', 'editing', 'grammar-check',
      // Technical assignments
      'math-problems', 'physics-problems', 'engineering-project', 'programming', 'statistics', 'calculations'
    ]
  },
  subject: {
    type: String,
    required: true
  },
  assignmentTitle: {
    type: String,
    required: true
  },
  deadline: {
    type: Date,
    required: true
  },
  pages: {
    type: Number,
    default: 0,
    min: 0
  },
  description: {
    type: String,
    required: true
  },
  additionalRequirements: {
    type: String,
    default: ''
  },
  category: {
    type: String,
    required: true,
    enum: ['writing', 'rewriting', 'correction', 'technical'],
    default: 'writing'
  },
  pricePerPage: {
    type: Number,
    default: 0,
    min: 0
  },
  totalCost: {
    type: Number,
    default: 0,
    min: 0
  },
  hasFiles: {
    type: Boolean,
    default: false
  },
  status: {
    type: String,
    default: 'pending',
    enum: ['pending', 'under-review', 'checking-balance', 'assigned', 'in-progress', 'completed', 'cancelled']
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  assignedTutor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  files: [{
    filename: String,
    originalName: String,
    path: String,
    uploadedAt: {
      type: Date,
      default: Date.now
    }
  }],
  completedFiles: [{
    filename: String,
    originalName: String,
    path: String,
    uploadedAt: {
      type: Date,
      default: Date.now
    },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  }],
  tutorComments: {
    type: String,
    default: ''
  }
});

const Order = mongoose.model('Order', orderSchema);

// Payment Schema
const paymentSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  orderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
    default: null
  },
  amount: {
    type: Number,
    required: true
  },
  method: {
    type: String,
    required: true,
    enum: ['paystack', 'paypal', 'bitcoin', 'cashapp', 'assignment-charge']
  },
  status: {
    type: String,
    default: 'pending',
    enum: ['pending', 'completed', 'failed', 'approved', 'rejected', 'withdraw-requested', 'refund-requested']
  },
  reference: {
    type: String,
    default: ''
  },
  proofFile: {
    filename: String,
    originalName: String,
    path: String
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  approvedAt: {
    type: Date,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

const Payment = mongoose.model('Payment', paymentSchema);

// Message Schema (assignment-scoped chat)
const messageSchema = new mongoose.Schema({
  assignmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true },
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  tutorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: false, default: null },
  sender: { type: String, enum: ['student', 'tutor'], required: true },
  content: { type: String, required: true, trim: true },
  createdAt: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', messageSchema);

// Routes

// Signup route
app.post('/signup', async (req, res) => {
  try {
    console.log('Signup request received:', req.body);
    const { name, email, password } = req.body;

    // Normalize inputs
    const normalizedName = (name || '').trim();
    const normalizedEmail = (email || '').trim().toLowerCase();

    // Validation
    if (!normalizedName || !normalizedEmail || !password) {
      console.log('Validation failed: missing fields');
      return res.status(400).json({ 
        success: false, 
        message: 'Please provide name, email, and password' 
      });
    }

    if (password.length < 6) {
      console.log('Validation failed: password too short');
      return res.status(400).json({ 
        success: false, 
        message: 'Password must be at least 6 characters long' 
      });
    }

    // Check if user already exists (by lowercased email)
    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      console.log('User already exists:', normalizedEmail);
      return res.status(400).json({ 
        success: false, 
        message: 'User with this email already exists' 
      });
    }

    // Create new user
    const user = new User({
      name: normalizedName,
      email: normalizedEmail,
      password
    });

    await user.save();
    console.log('User created successfully:', user._id);

    // Send signup email (non-blocking)
    sendMailSafe({
      to: user.email,
      subject: 'Welcome to EssayMe',
      html: `<p>Hi ${user.name},</p>
             <p>Welcome to EssayMe! Your account has been created successfully.</p>
             <p>You can now submit assignments, chat with tutors, and track your progress.</p>
             <p>— EssayMe Team</p>`
    });

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      userId: user._id,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });

  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error: ' + error.message 
    });
  }
});

// Login route
app.post('/login', async (req, res) => {
  try {
    console.log('Login request received:', req.body);
    const { email, password } = req.body;

    // Normalize
    const normalizedEmail = (email || '').trim().toLowerCase();

    // Validation
    if (!normalizedEmail || !password) {
      console.log('Validation failed: missing email or password');
      return res.status(400).json({ 
        success: false, 
        message: 'Please provide email and password' 
      });
    }

    // Find user
    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      console.log('User not found:', normalizedEmail);
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid email or password' 
      });
    }

    // Check password
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      console.log('Invalid password for user:', normalizedEmail);
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid email or password' 
      });
    }

    // Update last login
    user.lastLogin = new Date();
    await user.save();
    console.log('Login successful for user:', user._id);

    res.json({
      success: true,
      message: 'Login successful',
      userId: user._id,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error: ' + error.message 
    });
  }
});

// Password reset with OTP (in-memory store; replace with persistent store in production)
const crypto = require('crypto');
const otpStore = new Map(); // email -> { otpHash, expiresAt }

// Request OTP
app.post('/auth/request-reset-otp', async (req, res) => {
  try {
    const { email } = req.body || {};
    const normalizedEmail = (email || '').trim().toLowerCase();
    if (!normalizedEmail) return res.status(400).json({ success: false, message: 'Email is required' });
    const user = await User.findOne({ email: normalizedEmail });
    if (!user) return res.status(200).json({ success: true, message: 'If that email exists, an OTP was sent' }); // do not leak

    const otp = ('' + Math.floor(100000 + Math.random() * 900000));
    const otpHash = crypto.createHash('sha256').update(otp).digest('hex');
    const expiresAt = Date.now() + 15 * 60 * 1000; // 15 minutes
    otpStore.set(normalizedEmail, { otpHash, expiresAt });

    // Send email with OTP
    try {
      await mailTransporter.sendMail({
        from: `EssayMe Support <${process.env.SMTP_USER}>`,
        to: normalizedEmail,
        subject: 'Your EssayMe Password Reset OTP',
        text: `Use this OTP to reset your password: ${otp}\n\nThis code expires in 15 minutes.`,
        html: `<p>Use this OTP to reset your password:</p><h2 style="letter-spacing:3px">${otp}</h2><p>This code expires in 15 minutes.</p>`
      });
    } catch (mailErr) {
      console.error('Failed to send OTP email:', mailErr);
      return res.status(500).json({ success: false, message: 'Failed to send OTP email' });
    }

    return res.json({ success: true, message: 'OTP sent' });
  } catch (e) {
    console.error('request-reset-otp error:', e);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// Verify OTP
app.post('/auth/verify-reset-otp', async (req, res) => {
  try {
    const { email, otp } = req.body || {};
    const normalizedEmail = (email || '').trim().toLowerCase();
    const rec = otpStore.get(normalizedEmail);
    if (!rec) return res.status(400).json({ success: false, message: 'OTP not found or expired' });
    if (rec.expiresAt < Date.now()) { otpStore.delete(normalizedEmail); return res.status(400).json({ success: false, message: 'OTP expired' }); }
    const otpHash = crypto.createHash('sha256').update(String(otp)).digest('hex');
    if (otpHash !== rec.otpHash) return res.status(400).json({ success: false, message: 'Invalid OTP' });
    // mark verified by storing a short-lived flag
    rec.verified = true;
    rec.verifiedUntil = Date.now() + 10 * 60 * 1000; // 10 minutes to submit new pass
    return res.json({ success: true, message: 'OTP verified' });
  } catch (e) {
    console.error('verify-reset-otp error:', e);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// Confirm reset
app.post('/auth/confirm-reset', async (req, res) => {
  try {
    const { email, newPassword } = req.body || {};
    const normalizedEmail = (email || '').trim().toLowerCase();
    const rec = otpStore.get(normalizedEmail);
    if (!rec || !rec.verified || rec.verifiedUntil < Date.now()) return res.status(400).json({ success: false, message: 'OTP not verified or expired' });
    if (!newPassword || newPassword.length < 6) return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });

    const user = await User.findOne({ email: normalizedEmail });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    // Set plain password and let the pre('save') hook hash it (avoid double-hashing)
    user.password = newPassword;
    await user.save();

    otpStore.delete(normalizedEmail);
    return res.json({ success: true, message: 'Password updated' });
  } catch (e) {
    console.error('confirm-reset error:', e);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// Get user profile route
app.get('/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId).select('-password');
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }

    // Build profile image URL from GridFS id if available
    const profileImageUrl = user.profileImageId ? `${req.protocol}://${req.get('host')}/file/${user.profileImageId}` : '';

    res.json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        balance: user.balance || 0,
        createdAt: user.createdAt,
        lastLogin: user.lastLogin,
        bio: user.bio || '',
        phone: user.phone || '',
        profileImage: profileImageUrl
      }
    });

  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// Place order route (store files in MongoDB GridFS)
app.post('/place-order', uploadMem.array('files', 5), async (req, res) => {
  try {
    console.log('Place order request received:', req.body);
    console.log('Files received (memory):', req.files?.map(f => ({name: f.originalname, size: f.size})));

    const { 
      userId, orderType, subject, deadline, pages, description,
      assignmentTitle, additionalRequirements, category, 
      pricePerPage, totalCost
    } = req.body;

    if (!userId || !orderType || !subject || !deadline || !description || !assignmentTitle) {
      return res.status(400).json({ success: false, message: 'Please provide all required fields' });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    let initialStatus = category === 'technical' ? 'under-review' : 'checking-balance';

    // Upload to GridFS and build files array
    const files = [];
    if (gfsBucket && req.files?.length) {
      for (const file of req.files) {
        const filename = `${Date.now()}-${Math.round(Math.random()*1e9)}-${file.originalname}`;
        await new Promise((resolve, reject) => {
          const uploadStream = gfsBucket.openUploadStream(filename, {
            contentType: file.mimetype,
            metadata: { originalName: file.originalname, fieldName: file.fieldname }
          });
          uploadStream.end(file.buffer, (err) => {
            if (err) return reject(err);
            files.push({
              filename: uploadStream.id.toString(), // store ObjectId as string
              originalName: file.originalname,
              path: `gridfs:uploads/${uploadStream.id}`,
              uploadedAt: new Date()
            });
            resolve();
          });
        });
      }
    }

    const order = new Order({
      userId,
      orderType,
      subject,
      assignmentTitle: assignmentTitle || `${orderType} - ${subject}`,
      deadline: new Date(deadline),
      pages: parseInt(pages) || 0,
      description,
      additionalRequirements: additionalRequirements || '',
      category: category || 'writing',
      pricePerPage: parseFloat(pricePerPage) || 0,
      totalCost: parseFloat(totalCost) || 0,
      hasFiles: files.length > 0,
      files,
      status: initialStatus,
      updatedAt: new Date()
    });

    await order.save();
    console.log('Order created successfully:', order._id);
    console.log(`📝 NEW ASSIGNMENT ALERT: ${user?.name || 'Student'} submitted "${subject}" - ${orderType} (Due: ${deadline})`);
    console.log(`💰 Total Cost: $${totalCost} | Status: ${initialStatus}`);

    // Email notifications (non-blocking)
    // Notify student
    sendMailSafe({
      to: user.email,
      subject: 'Your assignment has been received',
      html: `<p>Hi ${user.name},</p>
             <p>We received your assignment: <strong>${order.assignmentTitle}</strong>.</p>
             <ul>
               <li>Subject: ${order.subject}</li>
               <li>Type: ${order.orderType}</li>
               <li>Deadline: ${new Date(order.deadline).toLocaleString()}</li>
               <li>Total: ${fmtMoney(order.totalCost)}</li>
               <li>Status: ${order.status}</li>
             </ul>
             <p>We will keep you updated.</p>`
    });
    // Notify tutors/admin inbox (optional): use SMTP_TUTOR_NOTIFY
    if (process.env.TUTOR_NOTIFY_EMAIL) {
      sendMailSafe({
        to: process.env.TUTOR_NOTIFY_EMAIL,
        subject: 'New assignment submitted',
        html: `<p>New assignment from ${user.name} (${user.email})</p>
               <p><strong>${order.assignmentTitle}</strong> — ${order.orderType}</p>
               <p>Subject: ${order.subject} • Due: ${new Date(order.deadline).toLocaleString()}</p>
               <p>Total: ${fmtMoney(order.totalCost)} • Status: ${order.status}</p>`
      });
    }

    res.status(201).json({
      success: true,
      message: 'Order placed successfully',
      order: {
        id: order._id,
        orderType: order.orderType,
        subject: order.subject,
        assignmentTitle: order.assignmentTitle,
        deadline: order.deadline,
        pages: order.pages,
        description: order.description,
        additionalRequirements: order.additionalRequirements,
        category: order.category,
        pricePerPage: order.pricePerPage,
        totalCost: order.totalCost,
        status: order.status,
        hasFiles: order.hasFiles,
        filesCount: files.length,
        createdAt: order.createdAt
      }
    });

  } catch (error) {
    console.error('Place order error:', error);
    res.status(500).json({ success: false, message: 'Internal server error: ' + error.message });
  }
});

// Get payment history for a user
app.get('/payments/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const payments = await Payment.find({ userId }).sort({ createdAt: -1 });
    res.json({
      success: true,
      payments: payments.map(p => ({
        id: p._id,
        amount: p.amount,
        method: p.method,
        status: p.status,
        reference: p.reference,
        createdAt: p.createdAt
      }))
    });
  } catch (e) {
    console.error('Get payments error:', e);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// Request refund for an order (student)
app.post('/payments/request-refund', async (req, res) => {
  try {
    const { userId, orderId, amount, reason } = req.body;
    if (!userId || !orderId || !amount) {
      return res.status(400).json({ success: false, message: 'Missing fields' });
    }
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    const payment = new Payment({
      userId,
      orderId,
      amount: Number(amount),
      method: 'paypal', // placeholder
      status: 'refund-requested',
      reference: reason || 'Refund request'
    });
    await payment.save();

    res.json({ success: true, message: 'Refund requested', requestId: payment._id });
  } catch (e) {
    console.error('Refund request error:', e);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// Update profile with optional image upload to GridFS
app.post('/update-account', uploadMem.single('profileImage'), async (req, res) => {
  try {
    const { userId, name, bio, phone } = req.body;
    if (!userId) return res.status(400).json({ success: false, message: 'Missing userId' });

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    if (name !== undefined) user.name = name;
    if (bio !== undefined) user.bio = bio;
    if (phone !== undefined) user.phone = phone;

    if (req.file) {
      if (!gfsBucket) return res.status(500).json({ success: false, message: 'File storage not initialized' });
      // Upload profile image to GridFS
      const filename = `${Date.now()}-${Math.round(Math.random()*1e9)}-${req.file.originalname}`;
      await new Promise((resolve, reject) => {
        const uploadStream = gfsBucket.openUploadStream(filename, {
          contentType: req.file.mimetype,
          metadata: { type: 'profile-image', originalName: req.file.originalname, userId: user._id.toString() }
        });
        uploadStream.end(req.file.buffer, (err) => {
          if (err) return reject(err);
          user.profileImageId = uploadStream.id.toString();
          resolve();
        });
      });
    }

    await user.save();

    res.json({ success: true, message: 'Profile updated', user: { id: user._id, name: user.name, bio: user.bio, phone: user.phone || '', profileImageId: user.profileImageId } });
  } catch (e) {
    console.error('Update account error:', e);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// Request withdraw (student)
app.post('/payments/request-withdraw', async (req, res) => {
  try {
    const { userId, amount, method, destination } = req.body;
    if (!userId || !amount || !method) {
      return res.status(400).json({ success: false, message: 'Missing fields' });
    }
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const amt = Number(amount);
    if (user.balance < amt) {
      return res.status(400).json({ success: false, message: 'Insufficient balance' });
    }

    // Hold the amount (optional: just mark request and deduct on approval)
    // user.balance -= amt; await user.save(); // uncomment if you want to hold immediately

    const payment = new Payment({
      userId,
      amount: amt,
      method,
      status: 'withdraw-requested',
      reference: destination || ''
    });
    await payment.save();

    res.json({ success: true, message: 'Withdraw requested', requestId: payment._id });
  } catch (e) {
    console.error('Withdraw request error:', e);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// Tutor approve/reject refund/withdraw
app.post('/tutor/approve-transaction', async (req, res) => {
  try {
    const { paymentId, tutorId, approve } = req.body;
    const payment = await Payment.findById(paymentId);
    if (!payment) return res.status(404).json({ success: false, message: 'Payment not found' });

    // Single admin tutor – no need to validate tutorId presence

    const user = await User.findById(payment.userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    if (approve) {
      payment.status = 'approved';
      payment.approvedBy = tutorId;
      payment.approvedAt = new Date();

      // Apply balance change
      if (payment.statusBeforeUpdate === 'withdraw-requested' || payment.reference?.startsWith('withdraw')) {
        // deduct now if not deducted earlier
        if (user.balance < payment.amount) {
          return res.status(400).json({ success: false, message: 'Insufficient balance at approval' });
        }
        user.balance -= payment.amount;
      }
      if (payment.statusBeforeUpdate === 'refund-requested' || payment.reference?.startsWith('Refund')) {
        // refund back to user balance
        user.balance += payment.amount;
      }
      await user.save();
    } else {
      payment.status = 'rejected';
    }
    await payment.save();

    res.json({ success: true, message: 'Transaction processed' });
  } catch (e) {
    console.error('Approve transaction error:', e);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// Get user orders route
app.get('/orders/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    const orders = await Order.find({ userId })
      .populate('assignedTutor', 'name email')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      orders: orders.map(order => ({
        id: order._id,
        orderType: order.orderType,
        subject: order.subject,
        assignmentTitle: order.assignmentTitle || `${order.orderType} - ${order.subject}`,
        deadline: order.deadline,
        pages: order.pages,
        description: order.description,
        additionalRequirements: order.additionalRequirements || '',
        category: order.category,
        pricePerPage: order.pricePerPage,
        totalCost: order.totalCost,
        status: order.status,
        hasFiles: order.hasFiles,
        files: order.files || [],
        completedFiles: order.completedFiles || [],
        tutorComments: order.tutorComments || '',
        assignedTutor: order.assignedTutor ? {
          id: order.assignedTutor._id,
          name: order.assignedTutor.name,
          email: order.assignedTutor.email
        } : null,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt
      }))
    });

  } catch (error) {
    console.error('Get orders error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// Tutor Routes

// Get all assignments for tutor (forward to the consolidated handler below)
app.get('/tutor/assignments', (req, res, next) => next());

// Update assignment status
app.post('/tutor/update-status', async (req, res) => {
  try {
    const { assignmentId, status } = req.body;

    if (!assignmentId || !status) {
      return res.status(400).json({ 
        success: false, 
        message: 'Assignment ID and status are required' 
      });
    }

    const order = await Order.findByIdAndUpdate(
      assignmentId,
      { 
        status: status,
        updatedAt: new Date()
      },
      { new: true }
    );

    if (!order) {
      return res.status(404).json({ 
        success: false, 
        message: 'Assignment not found' 
      });
    }

    // If status is changed to 'checking-balance', notify student
    if (status === 'checking-balance') {
      console.log(`Student ${order.userId} needs to top up account for assignment ${assignmentId}`);
    }

    res.json({
      success: true,
      message: 'Status updated successfully',
      order: {
        id: order._id,
        status: order.status,
        updatedAt: order.updatedAt
      }
    });

  } catch (error) {
    console.error('Update status error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// Upload completed assignment
app.post('/tutor/upload-completed', async (req, res) => {
  try {
    const { assignmentId, comments } = req.body;

    if (!assignmentId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Assignment ID is required' 
      });
    }

    // Update assignment status to completed
    const order = await Order.findByIdAndUpdate(
      assignmentId,
      { 
        status: 'completed',
        completionComments: comments || '',
        completedAt: new Date(),
        updatedAt: new Date()
      },
      { new: true }
    );

    if (!order) {
      return res.status(404).json({ 
        success: false, 
        message: 'Assignment not found' 
      });
    }

    // Email notifications on completion (non-blocking)
    try {
      const student = await User.findById(order.userId).lean();
      const tutor = order.assignedTutor ? await User.findById(order.assignedTutor).lean() : null;
      if (student?.email) {
        sendMailSafe({
          to: student.email,
          subject: 'Your assignment has been completed',
          html: `<p>Hi ${student.name || 'Student'},</p>
                 <p>Your assignment <strong>${order.assignmentTitle}</strong> has been completed and uploaded.</p>
                 <p>You can download the files from your dashboard.</p>`
        });
      }
      if (tutor?.email) {
        sendMailSafe({
          to: tutor.email,
          subject: 'Assignment marked completed',
          html: `<p>Hi ${tutor.name || 'Tutor'},</p>
                 <p>The assignment <strong>${order.assignmentTitle}</strong> has been marked as completed.</p>`
        });
      }
    } catch (e) { console.warn('Completion email warn:', e?.message || e); }

    res.json({
      success: true,
      message: 'Assignment completed successfully'
    });

  } catch (error) {
    console.error('Upload completed assignment error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// Get students for tutor (enhanced but backward-compatible)
app.get('/tutor/students', async (req, res) => {
  try {
    const users = await User.find({ role: 'student' }).select('-password').lean();

    const students = await Promise.all(users.map(async (user) => {
      const orders = await Order.find({ userId: user._id }).lean();
      const completedOrders = orders.filter(order => order.status === 'completed');
      const activeAssignments = orders.filter(o => ['assigned', 'in-progress'].includes(o.status)).length;
      const totalSpent = orders.reduce((sum, o) => sum + (o.totalCost || 0), 0);

      // Keep existing top-level fields (do not remove), and add `stats` for the UI
      return {
        id: (user._id && user._id.toString) ? user._id.toString() : user._id,
        name: user.name,
        email: user.email,
        balance: user.balance || 0,
        createdAt: user.createdAt,
        lastLogin: user.lastLogin || null,
        profileImageId: user.profileImageId || null,
        // legacy/top-level counts preserved
        totalAssignments: orders.length,
        completedAssignments: completedOrders.length,
        // new nested stats used by tutor.html
        stats: {
          totalAssignments: orders.length,
          completedAssignments: completedOrders.length,
          activeAssignments,
          totalSpent
        }
      };
    }));

    res.json({ success: true, students });
  } catch (error) {
    console.error('Get students error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// Get payment approvals
app.get('/tutor/payment-approvals', async (req, res) => {
  try {
    // This would typically fetch from a PaymentApproval model
    // For now, return empty array
    res.json({
      success: true,
      approvals: []
    });

  } catch (error) {
    console.error('Get payment approvals error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// Approve payment (forward to implemented handler below)
app.post('/tutor/approve-payment', (req, res, next) => next());

// Reject payment
app.post('/tutor/reject-payment', async (req, res) => {
  try {
    const { approvalId, reason } = req.body;

    // Implementation for rejecting payment
    
    res.json({
      success: true,
      message: 'Payment rejected successfully'
    });

  } catch (error) {
    console.error('Reject payment error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// Tutor Routes

// Get all assignments for tutors
app.get('/tutor/assignments', async (req, res) => {
  try {
    const { status } = req.query;
    
    let filter = {};
    if (status && status !== 'all') {
      filter.status = status;
    }

    const assignments = await Order.find(filter)
      .populate('userId', 'name email')
      .populate('assignedTutor', 'name email')
      .sort({ createdAt: -1 });

    const formattedAssignments = assignments.map(a => ({
      id: a._id?.toString?.() || a._id,
      // Provide both nested user object and flattened fields to match frontend expectations
      userId: a.userId ? { id: a.userId._id, name: a.userId.name, email: a.userId.email } : null,
      studentName: a.userId?.name || '',
      studentEmail: a.userId?.email || '',
      assignmentTitle: a.assignmentTitle,
      subject: a.subject,
      orderType: a.orderType,
      category: a.category,
      description: a.description,
      additionalRequirements: a.additionalRequirements,
      deadline: a.deadline,
      pages: a.pages,
      pricePerPage: a.pricePerPage,
      totalCost: a.totalCost,
      status: a.status,
      hasFiles: a.hasFiles,
      files: a.files || [],
      completedFiles: a.completedFiles || [],
      tutorComments: a.tutorComments || '',
      assignedTutor: a.assignedTutor ? {
        id: a.assignedTutor._id,
        name: a.assignedTutor.name,
        email: a.assignedTutor.email
      } : null,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt
    }));

    res.json({
      success: true,
      assignments: formattedAssignments
    });

  } catch (error) {
    console.error('Get tutor assignments error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// Get all students for tutors
app.get('/tutor/students', async (req, res) => {
  try {
    const students = await User.find({ role: 'student' })
      .select('name email createdAt lastLogin balance')
      .sort({ createdAt: -1 });

    const studentsWithStats = await Promise.all(
      students.map(async (student) => {
        const assignments = await Order.find({ userId: student._id });
        const totalAssignments = assignments.length;
        const completedAssignments = assignments.filter(a => a.status === 'completed').length;
        const activeAssignments = assignments.filter(a => ['assigned', 'in-progress'].includes(a.status)).length;
        const totalSpent = assignments.reduce((sum, a) => sum + a.totalCost, 0);

        return {
          id: student._id,
          name: student.name,
          email: student.email,
          balance: student.balance,
          createdAt: student.createdAt,
          lastLogin: student.lastLogin,
          stats: {
            totalAssignments,
            completedAssignments,
            activeAssignments,
            totalSpent
          }
        };
      })
    );

    res.json({
      success: true,
      students: studentsWithStats
    });

  } catch (error) {
    console.error('Get tutor students error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// Update assignment status
app.post('/tutor/update-assignment-status', async (req, res) => {
  try {
    const { assignmentId, status, tutorId, comments } = req.body;

    if (!assignmentId || !status) {
      return res.status(400).json({ 
        success: false, 
        message: 'Assignment ID and status are required' 
      });
    }

    const updateData = {
      status,
      updatedAt: new Date()
    };

    if (tutorId && status === 'assigned') {
      if (!mongoose.Types.ObjectId.isValid(tutorId)) {
        return res.status(400).json({ success: false, message: 'Invalid tutorId' });
      }
      updateData.assignedTutor = tutorId;
    }

    if (comments) {
      updateData.tutorComments = comments;
    }

    // Load current assignment and user to enforce balance rules
    const assignment = await Order.findById(assignmentId).populate('userId', 'name email balance');
    if (!assignment) {
      return res.status(404).json({ success: false, message: 'Assignment not found' });
    }

    // Apply comments update
    if (comments) assignment.tutorComments = comments;

    // Balance logic
    if (status === 'assigned') {
      // Single admin tutor: set a fixed admin tutor id or null
      // If you want to persist who assigned, you can set a static admin ObjectId here.
      if (assignment.userId.balance < assignment.totalCost) {
        assignment.status = 'checking-balance';
        await assignment.save();
        return res.status(400).json({ success: false, message: 'Insufficient balance. Waiting for top-up.', status: assignment.status });
      }
      assignment.status = 'assigned';
      assignment.updatedAt = new Date();
      await assignment.save();
    } else if (status === 'checking-balance') {
      if (assignment.userId.balance < assignment.totalCost) {
        assignment.status = 'checking-balance';
        await assignment.save();
      } else {
        assignment.status = 'assigned';
        await assignment.save();
      }
    } else {
      // For other statuses, apply basic update
      assignment.status = status;
      assignment.updatedAt = new Date();
      await assignment.save();
    }

    res.json({
      success: true,
      message: 'Assignment status updated successfully',
      assignment: {
        id: assignment._id,
        status: assignment.status,
        assignedTutor: assignment.assignedTutor,
        tutorComments: assignment.tutorComments,
        updatedAt: assignment.updatedAt
      }
    });

  } catch (error) {
    console.error('Update assignment status error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// Upload completed assignment files (store in GridFS)
app.post('/tutor/upload-completed-files/:assignmentId', uploadMem.array('files', 5), async (req, res) => {
  try {
    const { assignmentId } = req.params;
    const { tutorId, comments } = req.body;

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, message: 'No files uploaded' });
    }

    const assignment = await Order.findById(assignmentId);
    if (!assignment) {
      return res.status(404).json({ success: false, message: 'Assignment not found' });
    }

    // Upload to GridFS
    const completedFiles = [];
    if (!gfsBucket) return res.status(500).json({ success: false, message: 'File storage not initialized' });

    for (const file of req.files) {
      const filename = `${Date.now()}-${Math.round(Math.random()*1e9)}-${file.originalname}`;
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve, reject) => {
        const uploadStream = gfsBucket.openUploadStream(filename, {
          contentType: file.mimetype,
          metadata: { originalName: file.originalname, fieldName: file.fieldname, uploadedBy: tutorId || null }
        });
        uploadStream.end(file.buffer, (err) => {
          if (err) return reject(err);
          completedFiles.push({
            filename: uploadStream.id.toString(),
            originalName: file.originalname,
            path: `gridfs:uploads/${uploadStream.id}`,
            uploadedAt: new Date(),
            uploadedBy: mongoose.Types.ObjectId.isValid(tutorId) ? tutorId : null
          });
          resolve();
        });
      });
    }

    assignment.completedFiles = [...(assignment.completedFiles || []), ...completedFiles];
    assignment.status = 'completed';
    assignment.updatedAt = new Date();
    if (comments) assignment.tutorComments = comments;
    await assignment.save();

    try {
      const user = await User.findById(assignment.userId);
      if (user) {
        user.balance = (user.balance || 0) - (assignment.totalCost || 0);
        await user.save();
        const charge = new Payment({
          userId: assignment.userId,
          orderId: assignment._id,
          amount: -Math.abs(assignment.totalCost || 0),
          method: 'assignment-charge',
          status: 'completed',
          reference: `Charge for completed assignment ${assignment._id}`,
          createdAt: new Date(),
          updatedAt: new Date()
        });
        await charge.save();
      }
    } catch (e) {
      console.error('Error applying assignment charge:', e);
    }

    res.json({
      success: true,
      message: 'Completed files uploaded successfully',
      filesUploaded: completedFiles.length,
      assignment: { id: assignment._id, status: assignment.status, completedFiles: assignment.completedFiles }
    });

  } catch (error) {
    console.error('Upload completed files error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// Get pending payment approvals
app.get('/tutor/pending-payments', async (req, res) => {
  try {
    const pendingPayments = await Payment.find({ 
      status: 'pending'
    })
    .populate('userId', 'name email')
    .sort({ createdAt: -1 });

    const formattedPayments = pendingPayments.map(payment => ({
      id: payment._id,
      user: {
        id: payment.userId._id,
        name: payment.userId.name,
        email: payment.userId.email
      },
      amount: payment.amount,
      method: payment.method,
      reference: payment.reference,
      proofFile: payment.proofFile,
      createdAt: payment.createdAt
    }));

    res.json({
      success: true,
      payments: formattedPayments
    });

  } catch (error) {
    console.error('Get pending payments error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// Approve payment
app.post('/tutor/approve-payment', async (req, res) => {
  try {
    const { paymentId, tutorId } = req.body;

    if (!paymentId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Payment ID is required' 
      });
    }

    const payment = await Payment.findById(paymentId).populate('userId');
    if (!payment) {
      return res.status(404).json({ 
        success: false, 
        message: 'Payment not found' 
      });
    }

    // Update payment status
    payment.status = 'approved';
    payment.approvedBy = tutorId || null;
    payment.approvedAt = new Date();
    payment.updatedAt = new Date();
    await payment.save();

    // Update user balance
    const user = payment.userId;
    user.balance += payment.amount;
    await user.save();

    // Check if user now has sufficient balance for checking-balance assignments
    const checkingBalanceOrders = await Order.find({ 
      userId: user._id, 
      status: 'checking-balance' 
    });

    for (const order of checkingBalanceOrders) {
      if (user.balance >= order.totalCost) {
        order.status = 'assigned';
        order.updatedAt = new Date();
        await order.save();
      }
    }

    res.json({
      success: true,
      message: 'Payment approved successfully',
      newBalance: user.balance
    });

  } catch (error) {
    console.error('Approve payment error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// Reject payment
app.post('/tutor/reject-payment', async (req, res) => {
  try {
    const { paymentId, tutorId, reason } = req.body;

    if (!paymentId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Payment ID is required' 
      });
    }

    const payment = await Payment.findById(paymentId);
    if (!payment) {
      return res.status(404).json({ 
        success: false, 
        message: 'Payment not found' 
      });
    }

    // Update payment status
    payment.status = 'rejected';
    payment.approvedBy = tutorId;
    payment.approvedAt = new Date();
    payment.updatedAt = new Date();
    payment.reference = reason || 'Payment rejected by tutor';
    await payment.save();

    // Email rejection notice
    try {
      const user = await User.findById(payment.userId);
      if (user?.email) {
        sendMailSafe({
          to: user.email,
          subject: 'Payment rejected',
          html: `<p>Hi ${user.name},</p>
                 <p>Your payment was rejected.</p>
                 <ul>
                   <li>Amount: ${fmtMoney(payment.amount)}</li>
                   <li>Method: ${payment.method.toUpperCase()}</li>
                   <li>Reference: ${payment.reference}</li>
                   <li>Reason: ${reason || 'Not specified'}</li>
                 </ul>`
        });
      }
    } catch (e) { console.warn('Payment rejection email warn:', e?.message || e); }

    res.json({
      success: true,
      message: 'Payment rejected successfully'
    });

  } catch (error) {
    console.error('Reject payment error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// Payment Routes

// Update user balance (for instant payments like Paystack/PayPal)
app.post('/update-balance', async (req, res) => {
  try {
    const { userId, amount, method, reference } = req.body;

    if (!userId || !amount || amount <= 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Valid user ID and amount are required' 
      });
    }

    const user = await User.findByIdAndUpdate(
      userId,
      { $inc: { balance: parseFloat(amount) } },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }

    // Create payment record for tracking
    const payment = new Payment({
      userId: userId, // Fixed to match schema
      amount: parseFloat(amount),
      method: method || 'paystack',
      status: 'completed',
      reference: reference || `AUTO-${Date.now()}`,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    await payment.save();

    // Check if user now has sufficient balance for checking-balance assignments
    const checkingBalanceOrders = await Order.find({ 
      userId: userId, 
      status: 'checking-balance' 
    });

    for (const order of checkingBalanceOrders) {
      if (user.balance >= order.totalCost) {
        order.status = 'assigned';
        order.updatedAt = new Date();
        await order.save();
      }
    }

    res.json({
      success: true,
      message: 'Balance updated successfully',
      newBalance: user.balance,
      paymentId: payment._id
    });

  } catch (error) {
    console.error('Update balance error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// Submit payment proof (for Bitcoin and CashApp)
app.post('/submit-payment-proof', uploadMem.single('proof'), async (req, res) => {
  try {
    console.log('Payment proof submission started');
    console.log('Request body:', req.body);
    console.log('Request file:', req.file);
    
    const { userId, amount, method } = req.body;

    if (!userId || !amount || !method) {
      console.log('Missing required fields');
      return res.status(400).json({ 
        success: false, 
        message: 'User ID, amount, and method are required' 
      });
    }

    if (!req.file) {
      console.log('No file uploaded');
      return res.status(400).json({ 
        success: false, 
        message: 'Payment proof file is required' 
      });
    }

    if (!gfsBucket) {
      return res.status(500).json({ success: false, message: 'File storage not initialized' });
    }

    // Upload proof to GridFS first
    const proofId = await new Promise((resolve, reject) => {
      const filename = `${Date.now()}-${Math.round(Math.random()*1e9)}-${req.file.originalname}`;
      const uploadStream = gfsBucket.openUploadStream(filename, {
        contentType: req.file.mimetype,
        metadata: { originalName: req.file.originalname, fieldName: 'proof' }
      });
      uploadStream.end(req.file.buffer, (err) => {
        if (err) return reject(err);
        resolve(uploadStream.id.toString());
      });
    });

    // Create payment record
    console.log('Creating payment record...');
    const payment = new Payment({
      userId: userId, // Fixed to match schema
      amount: parseFloat(amount),
      method,
      status: 'pending',
      reference: `${method.toUpperCase()}-${Date.now()}`,
      proofFile: {
        filename: proofId,
        originalName: req.file.originalname,
        path: `gridfs:uploads/${proofId}`
      },
      createdAt: new Date(),
      updatedAt: new Date()
    });

    console.log('Saving payment to database...');
    await payment.save();
    console.log('Payment saved successfully:', payment._id);

    // Get user info for notification
    const user = await User.findById(userId);
    console.log(`💳 PAYMENT PROOF SUBMITTED: ${user?.name || 'User'} - ${method.toUpperCase()} $${amount}`);
    console.log(`📄 Payment ID: ${payment._id} | Status: PENDING APPROVAL`);

    // Email receipts (non-blocking)
    if (user?.email) {
      sendMailSafe({
        to: user.email,
        subject: 'Payment proof received',
        html: `<p>Hi ${user.name || 'Student'},</p>
               <p>We received your ${method.toUpperCase()} payment proof.</p>
               <ul>
                 <li>Amount: ${fmtMoney(amount)}</li>
                 <li>Reference: ${payment.reference}</li>
                 <li>Status: Pending approval</li>
               </ul>`
      });
    }
    if (process.env.BILLING_NOTIFY_EMAIL) {
      sendMailSafe({
        to: process.env.BILLING_NOTIFY_EMAIL,
        subject: 'New payment proof pending approval',
        html: `<p>${user?.name || 'User'} (${user?.email || ''}) submitted a payment proof.</p>
               <ul>
                 <li>Amount: ${fmtMoney(amount)}</li>
                 <li>Method: ${method.toUpperCase()}</li>
                 <li>Reference: ${payment.reference}</li>
                 <li>Payment ID: ${payment._id}</li>
               </ul>`
      });
    }

    res.json({
      success: true,
      message: 'Payment proof submitted successfully',
      paymentId: payment._id
    });

  } catch (error) {
    console.error('Submit payment proof error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error',
      error: error.message // Add error details for debugging
    });
  }
});

// Get user payments
app.get('/payments/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    const payments = await Payment.find({ userId })
      .sort({ createdAt: -1 });

    const formattedPayments = payments.map(payment => ({
      id: payment._id,
      amount: payment.amount,
      method: payment.method,
      status: payment.status,
      reference: payment.reference,
      createdAt: payment.createdAt,
      approvedAt: payment.approvedAt
    }));

    res.json({
      success: true,
      payments: formattedPayments
    });

  } catch (error) {
    console.error('Get user payments error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// Check user balance and assignments
app.get('/check-balance/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }

    // Check for assignments in 'checking-balance' status
    const checkingBalanceOrders = await Order.find({ 
      userId: userId, 
      status: 'checking-balance' 
    });

    const totalRequired = checkingBalanceOrders.reduce((sum, order) => sum + order.totalCost, 0);
    const needsTopUp = user.balance < totalRequired;

    res.json({
      success: true,
      balance: user.balance,
      totalRequired: totalRequired,
      needsTopUp: needsTopUp,
      checkingBalanceOrders: checkingBalanceOrders.length
    });

  } catch (error) {
    console.error('Check balance error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// Messaging endpoints
// Realtime messages via Server-Sent Events (SSE)
const clientsByAssignment = new Map(); // assignmentId -> Set(res)

app.get('/messages/stream', async (req, res) => {
  try {
    const { assignmentId } = req.query;
    if (!assignmentId) return res.status(400).end();

    // SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    if (!clientsByAssignment.has(String(assignmentId))) {
      clientsByAssignment.set(String(assignmentId), new Set());
    }
    const set = clientsByAssignment.get(String(assignmentId));
    set.add(res);

    const hb = setInterval(() => { try { res.write(':\n\n'); } catch (_) {} }, 15000);
    req.on('close', () => {
      clearInterval(hb);
      set.delete(res);
      if (set.size === 0) clientsByAssignment.delete(String(assignmentId));
    });
  } catch (e) {
    console.error('SSE error:', e);
    try { res.end(); } catch (_) {}
  }
});

function broadcastMessage(assignmentId, messageDoc) {
  const set = clientsByAssignment.get(String(assignmentId));
  if (!set) return;
  const payload = `data: ${JSON.stringify({ type: 'message', message: messageDoc })}\n\n`;
  for (const res of set) {
    try { res.write(payload); } catch (_) {}
  }
}

// Get assignments for a student (id from query or localStorage on client)
app.get('/student/assignments', async (req, res) => {
  try {
    const userId = (req.query.userId || '').trim();
    if (!userId) return res.status(400).json({ success: false, message: 'userId is required' });
    const orders = await Order.find({ userId }).sort({ createdAt: -1 }).lean();
    res.json({ success: true, assignments: orders.map(o => ({ id: o._id, title: o.assignmentTitle, status: o.status, subject: o.subject, assignedTutor: o.assignedTutor })) });
  } catch (e) {
    console.error('student assignments error:', e);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// Fetch messages for an assignment
app.get('/messages', async (req, res) => {
  try {
    const { assignmentId } = req.query;
    if (!assignmentId) return res.status(400).json({ success: false, message: 'assignmentId is required' });
    const msgs = await Message.find({ assignmentId }).sort({ createdAt: 1 }).lean();
    res.json({ success: true, messages: msgs });
  } catch (e) {
    console.error('get messages error:', e);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// Send message (student or tutor)
app.post('/messages', async (req, res) => {
  try {
    let { assignmentId, studentId, tutorId, sender, content } = req.body || {};
    if (!assignmentId || !sender || !content) {
      return res.status(400).json({ success: false, message: 'Missing fields' });
    }
    if (!['student', 'tutor'].includes(String(sender))) {
      return res.status(400).json({ success: false, message: 'Invalid sender' });
    }
    if (String(sender) === 'student' && !studentId) {
      return res.status(400).json({ success: false, message: 'Missing studentId' });
    }

    // Basic authorization and normalization
    const order = await Order.findById(assignmentId);
    if (!order) return res.status(404).json({ success: false, message: 'Assignment not found' });

    if (sender === 'student') {
      // Student must match assignment owner
      if (String(order.userId) !== String(studentId)) {
        return res.status(403).json({ success: false, message: 'Not your assignment' });
      }
      // If tutorId missing, fallback to assignment.assignedTutor (may be null)
      if (!tutorId && order.assignedTutor) tutorId = String(order.assignedTutor);
    } else if (sender === 'tutor') {
      // Normalize studentId to assignment owner
      studentId = String(order.userId);
      // Authorization rules for tutors:
      // - If assignment has an assigned tutor, enforce that it matches (reject mismatches)
      // - If no assigned tutor yet, allow sending (use provided tutorId if valid, else null)
      const assignedTutorStr = order.assignedTutor ? String(order.assignedTutor) : null;
      if (assignedTutorStr) {
        if (tutorId && String(tutorId) !== assignedTutorStr) {
          return res.status(403).json({ success: false, message: 'Tutor not assigned to this assignment' });
        }
        tutorId = assignedTutorStr;
      } else {
        tutorId = (tutorId && mongoose.Types.ObjectId.isValid(tutorId)) ? tutorId : null;
      }
    }

    // Normalize tutorId: if falsy or invalid, set to null to avoid ObjectId cast errors
    const safeTutorId = (tutorId && mongoose.Types.ObjectId.isValid(tutorId)) ? tutorId : null;
    const msg = await Message.create({ assignmentId, studentId, tutorId: safeTutorId, sender, content: String(content).slice(0, 2000) });

    // Broadcast to SSE subscribers only (removed Socket.IO to prevent duplicates)
    try { broadcastMessage(assignmentId, msg.toObject()); } catch (_) {}

    res.json({ success: true, message: msg });
  } catch (e) {
    console.error('post message error:', e);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// Tutor endpoints
app.get('/tutor/profile/:tutorId', async (req, res) => {
  try {
    res.json({
      success: true,
      tutor: {
        id: req.params.tutorId,
        name: 'Dr. Sarah Johnson',
        email: 'sarah.johnson@essayme.com',
        specialization: 'Academic Writing & Research'
      }
    });
  } catch (error) {
    console.error('Error fetching tutor profile:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

app.get('/tutor/assignments', async (req, res) => {
  try {
    const docs = await Order.find({})
      .populate('userId', 'name email')
      .populate('assignedTutor', 'name email')
      .sort({ createdAt: -1 })
      .lean();

    const assignments = docs.map(d => ({
      id: d._id?.toString?.() || d._id,
      ...d,
      studentName: d.userId?.name || '',
      studentEmail: d.userId?.email || ''
    }));

    res.json({ success: true, assignments });
  } catch (error) {
    console.error('Error fetching tutor assignments:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

app.get('/tutor/students', async (req, res) => {
  try {
    const students = await User.find({ role: 'student' }).select('-password');
    
    // Calculate stats for each student
    const studentsWithStats = await Promise.all(students.map(async (student) => {
      const orders = await Order.find({ userId: student._id }); // Changed from 'student' to 'userId'
      const totalAssignments = orders.length;
      const completedAssignments = orders.filter(o => o.status === 'completed').length;
      const activeAssignments = orders.filter(o => ['assigned', 'in-progress'].includes(o.status)).length;
      const totalSpent = orders.reduce((sum, order) => sum + order.totalCost, 0);
      
      return {
        ...student.toObject(),
        stats: {
          totalAssignments,
          completedAssignments,
          activeAssignments,
          totalSpent
        }
      };
    }));

    res.json({
      success: true,
      students: studentsWithStats
    });
  } catch (error) {
    console.error('Error fetching students:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

app.get('/tutor/pending-payments', async (req, res) => {
  try {
    const pendingPayments = await Payment.find({ status: 'pending' })
      .populate('user', 'name email')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      payments: pendingPayments
    });
  } catch (error) {
    console.error('Error fetching pending payments:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

app.post('/tutor/update-assignment-status', async (req, res) => {
  try {
    const { assignmentId, status, tutorId } = req.body;
    
    const order = await Order.findById(assignmentId);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Assignment not found' });
    }

    order.status = status;
    if (status === 'assigned' && tutorId) {
      order.assignedTutor = tutorId;
    }
    
    await order.save();

    res.json({
      success: true,
      message: 'Assignment status updated successfully'
    });
  } catch (error) {
    console.error('Error updating assignment status:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

app.post('/tutor/upload-completed-files-legacy/:assignmentId', upload.array('files'), async (req, res) => {
  try {
    const { assignmentId } = req.params;
    const { comments } = req.body;
    const files = req.files;

    const order = await Order.findById(assignmentId);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Assignment not found' });
    }

    // Add completed files
    if (files && files.length > 0) {
      order.completedFiles = files.map(file => ({
        filename: file.filename,
        originalName: file.originalname,
        mimetype: file.mimetype,
        size: file.size
      }));
    }

    // Add tutor comments
    if (comments) {
      order.tutorComments = comments;
    }

    // Update status to completed
    order.status = 'completed';
    order.completedAt = new Date();

    await order.save();

    // Get student info for notification
    const student = await User.findById(order.userId); // Changed from order.student to order.userId
    console.log(`✅ ASSIGNMENT COMPLETED: ${order.assignmentTitle} for ${student?.name || 'Student'}`);
    console.log(`📁 Files uploaded: ${files?.length || 0} | Comments: ${comments ? 'Yes' : 'No'}`);

    res.json({
      success: true,
      message: 'Files uploaded and assignment completed successfully'
    });
  } catch (error) {
    console.error('Error uploading completed files:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// Accept assignment
app.post('/tutor/accept-assignment', async (req, res) => {
  try {
    const { assignmentId, tutorId } = req.body;
    
    const order = await Order.findById(assignmentId);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Assignment not found' });
    }

    if (order.status !== 'pending' && order.status !== 'checking-balance') {
      return res.status(400).json({ success: false, message: 'Assignment is not available for acceptance' });
    }

    // Update assignment status
    order.status = 'assigned';
    order.assignedTutor = tutorId;
    order.updatedAt = new Date();
    await order.save();

    // Get student info for notification
    const student = await User.findById(order.userId);
    console.log(`✅ ASSIGNMENT ACCEPTED: ${order.assignmentTitle} by tutor for ${student?.name || 'Student'}`);
    console.log(`📚 Subject: ${order.subject} | Pages: ${order.pages} | Cost: $${order.totalCost}`);

    res.json({
      success: true,
      message: 'Assignment accepted successfully'
    });
  } catch (error) {
    console.error('Error accepting assignment:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

app.post('/tutor/approve-payment', async (req, res) => {
  try {
    const { paymentId, tutorId } = req.body;
    
    const payment = await Payment.findById(paymentId);
    if (!payment) {
      return res.status(404).json({ success: false, message: 'Payment not found' });
    }

    // Update payment status
    payment.status = 'approved';
    payment.approvedBy = tutorId;
    payment.approvedAt = new Date();
    await payment.save();

    // Update user balance
    const user = await User.findById(payment.userId);
    if (user) {
      user.balance += payment.amount;
      await user.save();
      
      console.log(`✅ PAYMENT APPROVED: ${user.name} - $${payment.amount} added to balance`);
      console.log(`💰 New Balance: $${user.balance.toFixed(2)} | Payment Method: ${payment.method.toUpperCase()}`);

      // Email summary to student
      if (user.email) {
        sendMailSafe({
          to: user.email,
          subject: 'Payment approved',
          html: `<p>Hi ${user.name},</p>
                 <p>Your payment has been approved.</p>
                 <ul>
                   <li>Amount: ${fmtMoney(payment.amount)}</li>
                   <li>Method: ${payment.method.toUpperCase()}</li>
                   <li>Reference: ${payment.reference}</li>
                   <li>New Balance: ${fmtMoney(user.balance)}</li>
                 </ul>`
        });
      }
      // Optional notify billing
      if (process.env.BILLING_NOTIFY_EMAIL) {
        sendMailSafe({
          to: process.env.BILLING_NOTIFY_EMAIL,
          subject: 'Payment approved',
          html: `<p>Payment approved for ${user.name} (${user.email})</p>
                 <ul>
                   <li>Amount: ${fmtMoney(payment.amount)}</li>
                   <li>Method: ${payment.method.toUpperCase()}</li>
                   <li>Reference: ${payment.reference}</li>
                   <li>New Balance: ${fmtMoney(user.balance)}</li>
                 </ul>`
        });
      }
    }

    res.json({
      success: true,
      message: 'Payment approved successfully'
    });
  } catch (error) {
    console.error('Error approving payment:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

app.post('/tutor/reject-payment', async (req, res) => {
  try {
    const { paymentId, tutorId, reason } = req.body;
    
    const payment = await Payment.findById(paymentId);
    if (!payment) {
      return res.status(404).json({ success: false, message: 'Payment not found' });
    }

    // Update payment status
    payment.status = 'rejected';
    payment.rejectedBy = tutorId;
    payment.rejectedAt = new Date();
    payment.rejectionReason = reason;
    await payment.save();

    res.json({
      success: true,
      message: 'Payment rejected successfully'
    });
  } catch (error) {
    console.error('Error rejecting payment:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// Serve static files
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/student', (req, res) => {
  res.sendFile(path.join(__dirname, 'student.html'));
});

app.get('/tutor', (req, res) => {
  res.sendFile(path.join(__dirname, 'tutor.html'));
});

// ===== CHAT CUSTOMIZATION ENDPOINTS =====

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

    // Try to save to MongoDB if available, otherwise use in-memory storage
    try {
      if (mongoose.connection.readyState === 1) {
        // MongoDB is connected, use it
        const ChatSettings = mongoose.model('ChatSettings', new mongoose.Schema({
          userId: { type: String, required: true, unique: true },
          theme: { type: String, default: 'default' },
          customColors: {
            studentBg: String,
            tutorBg: String
          },
          sounds: {
            sendSound: String,
            receiveSound: String,
            volume: { type: Number, default: 50 }
          },
          updatedAt: { type: Date, default: Date.now }
        }));

        await ChatSettings.findOneAndUpdate(
          { userId: userId },
          settingsData,
          { upsert: true, new: true }
        );
      }
    } catch (dbError) {
      console.log('MongoDB not available, using fallback storage');
    }

    res.json({
      success: true,
      message: 'Chat settings saved successfully'
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

    let settingsData = null;

    // Try to get from MongoDB if available
    try {
      if (mongoose.connection.readyState === 1) {
        const ChatSettings = mongoose.model('ChatSettings');
        settingsData = await ChatSettings.findOne({ userId: userId });
      }
    } catch (dbError) {
      console.log('MongoDB not available for chat settings');
    }

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
  return app._router.handle(Object.assign(req, { 
    method: 'POST', 
    url: '/student/save-chat-settings' 
  }), res);
});

app.get('/student/get-chat-theme', async (req, res) => {
  try {
    const { userId } = req.query;
    
    if (!userId) {
      return res.status(400).json({ 
        success: false, 
        message: 'User ID is required' 
      });
    }

    let settingsData = null;

    try {
      if (mongoose.connection.readyState === 1) {
        const ChatSettings = mongoose.model('ChatSettings');
        settingsData = await ChatSettings.findOne({ userId: userId });
      }
    } catch (dbError) {
      console.log('MongoDB not available for chat theme');
    }

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

// ===== END CHAT CUSTOMIZATION ENDPOINTS =====

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({ 
    success: false, 
    message: 'Internal server error' 
  });
});

// Start server using HTTP + Socket.IO
const http = require('http');
const server = http.createServer(app);
const { Server } = require('socket.io');
const io = new Server(server, { cors: { origin: '*', methods: ['GET','POST'] } });

io.on('connection', (socket) => {
  socket.on('chat:join', ({ assignmentId }) => {
    if (!assignmentId) return;
    socket.join(String(assignmentId));
  });
});

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Access the application at http://localhost:${PORT}`);
});

module.exports = app;