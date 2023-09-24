const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const session = require('express-session');
const app = express();

app.use(express.static('public'));
app.use(bodyParser.urlencoded({ extended: true }));
app.set('view engine', 'ejs');

// Load environment variables from .env file
require('dotenv').config();

mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

const userSchema = new mongoose.Schema({
  username: String,
  email: String,
  password: String,
});

const User = mongoose.model('User', userSchema);

const postSchema = new mongoose.Schema({
  title: String,
  link: String,
  category: String,
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  likes: [
    {
      userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    },
  ],
  dislikes: [
    {
      userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    },
  ],
  timestamp: {
    type: Date,
    default: Date.now,
  },
  comments: [
    {
      text: String,
      userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    },
  ],
});

const Post = mongoose.model('Post', postSchema);

app.use(
  session({
    secret: process.env.SESSION_SECRET, // Change this to a secure secret key
    resave: false,
    saveUninitialized: true,
  })
);

// Function to calculate time ago
function timeAgo(timestamp) {
  const now = new Date();
  const postedTime = new Date(timestamp);
  const timeDiff = now - postedTime;
  const seconds = Math.floor(timeDiff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return days + ' day(s) ago';
  } else if (hours > 0) {
    return hours + ' hour(s) ago';
  } else if (minutes > 0) {
    return minutes + ' minute(s) ago';
  } else {
    return 'Just now';
  }
}

// Registration route
app.get('/register', (req, res) => {
  res.render('login-register', { error: null });
});

app.post('/register', async (req, res) => {
  const { username, email, password } = req.body;

  try {
    const existingUser = await User.findOne({ email });

    if (existingUser) {
      return res.render('login-register', { error: 'Email already registered' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = new User({
      username,
      email,
      password: hashedPassword,
    });

    await newUser.save();
    console.log('User registered successfully.');
    res.redirect('/login');
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .render('login-register', { error: 'Internal server error' });
  }
});

// Login route
app.get('/login', (req, res) => {
  res.render('login-register', { error: null });
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await User.findOne({ email });

    if (!user) {
      return res.render('login-register', { error: 'Invalid email or password' });
    }

    const passwordMatch = await bcrypt.compare(password, user.password);

    if (!passwordMatch) {
      return res.render('login-register', { error: 'Invalid email or password' });
    }

    req.session.user = user;

    res.redirect('/dashboard');
  } catch (error) {
    console.error(error);
    res
      .status(500)
      .render('login-register', { error: 'Internal server error' });
  }
});

app.get('/dashboard', async (req, res) => {
  const { search, category } = req.query; // Get the search query and category from the URL
  const filter = {};

  if (search) {
    filter.title = { $regex: new RegExp(search, 'i') }; // Case-insensitive title search
  }

  if (category && category !== 'All') {
    filter.category = category; // Filter by category if specified
  }

  try {
    const posts = await Post.find(filter)
      .populate('userId', 'username')
      .populate('comments.userId', 'username')
      .sort({ timestamp: -1 });

    const categorizedPosts = {};

    // Categorize posts by category
    posts.forEach(post => {
      if (!categorizedPosts[post.category]) {
        categorizedPosts[post.category] = [];
      }
      categorizedPosts[post.category].push(post);
    });

    res.render('dashboard', {
      user: req.session.user,
      posts: categorizedPosts,
      error: null,
      timeAgo,
      search,
      selectedCategory: category || 'All', // Pass the selected category to the template
    });
  } catch (error) {
    console.error(error);
    res.status(500).render('dashboard', {
      user: req.session.user,
      posts: {},
      error: 'Error fetching posts',
      timeAgo,
      search: '',
      selectedCategory: 'All', // Pass the selected category to the template
    });
  }
});

// Add a new route to handle the search request
app.get('/search', async (req, res) => {
  const { search } = req.query; // Get the search query from the request

  try {
    // Perform a database query to find related links by title
    const results = await Post.find({ title: { $regex: search, $options: 'i' } });

    // Render a partial view or HTML with the search results
    res.render('search-results', { results });
  } catch (error) {
    console.error(error);
    res.status(500).send('Internal server error');
  }
});

// Logout route
app.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error(err);
    }
    res.redirect('/login');
  });
});

// Post Description route
app.post('/post-description', async (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }

  const { title, link, category } = req.body;
  const userId = req.session.user._id;

  try {
    const newPost = new Post({
      title,
      link,
      category,
      userId,
      likes: [],
      dislikes: [],
      comments: [],
    });

    await newPost.save();
    res.redirect('/dashboard');
  } catch (error) {
    console.error(error);
    res
      .status(500)
      .render('dashboard', {
        user: req.session.user,
        posts: {},
        error: 'Error posting description',
        timeAgo,
        search: '',
      });
  }
});

// Like route
app.get('/like-post/:id', async (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }

  try {
    const postId = req.params.id;
    const post = await Post.findById(postId);

    if (!post) {
      return res.status(404).send('Post not found');
    }

    const userId = req.session.user._id;

    // Check if the user has already liked this post
    if (post.likes.some((like) => like.userId.equals(userId))) {
      return res.status(400).send('You have already liked this post');
    }

    // Remove dislike if the user has previously disliked this post
    const userDislikeIndex = post.dislikes.findIndex((dislike) =>
      dislike.userId.equals(userId)
    );
    if (userDislikeIndex !== -1) {
      post.dislikes.splice(userDislikeIndex, 1);
    }

    post.likes.push({ userId });
    await post.save();
    res.redirect('/dashboard');
  } catch (error) {
    console.error(error);
    res.status(500).send('Internal server error');
  }
});

// Dislike route
app.get('/dislike-post/:id', async (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }

  try {
    const postId = req.params.id;
    const post = await Post.findById(postId);

    if (!post) {
      return res.status(404).send('Post not found');
    }

    const userId = req.session.user._id;

    // Check if the user has already disliked this post
    if (post.dislikes.some((dislike) => dislike.userId.equals(userId))) {
      return res.status(400).send('You have already disliked this post');
    }

    // Remove like if the user has previously liked this post
    const userLikeIndex = post.likes.findIndex((like) =>
      like.userId.equals(userId)
    );
    if (userLikeIndex !== -1) {
      post.likes.splice(userLikeIndex, 1);
    }

    post.dislikes.push({ userId });
    await post.save();
    res.redirect('/dashboard');
  } catch (error) {
    console.error(error);
    res.status(500).send('Internal server error');
  }
});

// Comment route
app.post('/comment/:id', async (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }

  try {
    const postId = req.params.id;
    const { text } = req.body;
    const userId = req.session.user._id;

    const post = await Post.findById(postId);

    if (!post) {
      return res.status(404).send('Post not found');
    }

    if (post.comments.length >= 10) {
      return res.status(400).send('Maximum comment limit reached');
    }

    const newComment = {
      text,
      userId,
    };

    post.comments.push(newComment);
    await post.save();
    res.redirect('/dashboard');
  } catch (error) {
    console.error(error);
    res.status(500).send('Internal server error');
  }
});

// Add this route to your app.js file
app.post('/post-link', async (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }

  const { title, link, category } = req.body;
  const userId = req.session.user._id;

  try {
    const newPost = new Post({
      title,
      link,
      category,
      userId,
      likes: [],
      dislikes: [],
      comments: [],
    });

    await newPost.save();
    res.redirect('/dashboard');
  } catch (error) {
    console.error(error);
    res.status(500).render('dashboard', {
      user: req.session.user,
      posts: {},
      error: 'Error posting description',
      timeAgo,
      search: '',
    });
  }
});

// Start the server
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server started on port ${port}`);
});
