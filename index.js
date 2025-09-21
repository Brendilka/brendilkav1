const express = require('express');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcrypt');
const Database = require('better-sqlite3');

const app = express();
const port = process.env.PORT || 3000;
const saltRounds = 10;

// Database setup
const db = new Database('brendilka.db');
db.pragma('foreign_keys = ON');

// Transaction to create tables
db.transaction(() => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_details (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER UNIQUE NOT NULL,
      full_name TEXT, employee_id TEXT, job_title TEXT, department TEXT,
      manager_name TEXT, home_address TEXT, phone_number TEXT, personal_email TEXT,
      site_location TEXT, job_grade TEXT, business_email TEXT,
      emergency_contact_name TEXT, emergency_contact_phone TEXT,
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS leave_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      leave_type TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      hours_requested REAL,
      comments TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      approved_at DATETIME,
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    )
  `);
  // Corrected and finalized table for shift swaps
  db.exec(`
    CREATE TABLE IF NOT EXISTS shift_swaps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      requester_id INTEGER NOT NULL,
      requester_shift TEXT NOT NULL,
      requested_shift TEXT NOT NULL,
      requested_with_id INTEGER,
      accepter_id INTEGER,
      status TEXT NOT NULL DEFAULT 'pending',
      FOREIGN KEY (requester_id) REFERENCES users (id) ON DELETE CASCADE,
      FOREIGN KEY (requested_with_id) REFERENCES users (id) ON DELETE SET NULL,
      FOREIGN KEY (accepter_id) REFERENCES users (id) ON DELETE SET NULL
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS employee_schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      week_start_date TEXT NOT NULL,
      day_of_week INTEGER NOT NULL,
      shift_start_time TEXT,
      shift_end_time TEXT,
      shift_type TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS employee_schedule_patterns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      pattern_weeks INTEGER NOT NULL DEFAULT 1,
      is_active BOOLEAN DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS leave_balances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER UNIQUE NOT NULL,
      annual_leave REAL DEFAULT 80.0,
      sick_leave REAL DEFAULT 80.0,
      long_service_leave REAL DEFAULT 0.0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    )
  `);
})();


// --- MIDDLEWARE ---
app.use(session({
  secret: 'a-very-strong-secret-key-that-you-should-change',
  resave: false,
  saveUninitialized: true,
  cookie: {
    secure: false
  }
}));
app.use(express.json());
app.use(express.urlencoded({
  extended: true
}));
app.use(express.static(path.join(__dirname, '')));

// Authentication check middleware
const checkAuth = (req, res, next) => {
  if (req.session.user) {
    return next();
  }
  res.status(401).json({
    message: 'Unauthorized: Please log in.'
  });
};

// --- API Endpoints ---
app.get('/api/admin/users', (req, res) => {
  try {
    const stmt = db.prepare(`SELECT u.id, u.username, u.role, ud.full_name, ud.job_title FROM users u LEFT JOIN user_details ud ON u.id = ud.user_id`);
    res.json(stmt.all());
  } catch (error) {
    console.error("Error fetching users for admin panel:", error);
    res.status(500).json({ message: "Database error" });
  }
});

// *** UPDATED: This endpoint now filters out managers ***
app.get('/api/colleagues', checkAuth, (req, res) => {
  try {
    const stmt = db.prepare(`
      SELECT u.id, u.username, ud.full_name 
      FROM users u 
      JOIN user_details ud ON u.id = ud.user_id 
      WHERE u.id != ? AND u.role != 'manager'
    `);
    res.json(stmt.all(req.session.user.id));
  } catch (error) {
    console.error("Error fetching colleagues:", error);
    res.status(500).json({ message: "Database error" });
  }
});


app.get('/api/user/details', checkAuth, (req, res) => {
  const stmt = db.prepare('SELECT u.username, ud.* FROM user_details ud JOIN users u ON u.id = ud.user_id WHERE ud.user_id = ?');
  const userDetails = stmt.get(req.session.user.id);
  userDetails ? res.json(userDetails) : res.status(404).json({
    message: 'User details not found'
  });
});

app.get('/api/user/current', checkAuth, (req, res) => {
    console.log('DEBUG: Current user session:', req.session.user);
    res.json(req.session.user);
});

app.get('/api/user/:id', (req, res) => {
  try {
    const stmt = db.prepare('SELECT * FROM users u LEFT JOIN user_details ud ON u.id = ud.user_id WHERE u.id = ?');
    const user = stmt.get(req.params.id);
    user ? res.json(user) : res.status(404).json({
      message: 'User not found'
    });
  } catch (err) {
    res.status(500).json({
      message: 'Database error'
    });
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).send('Could not log out.');
    }
    res.redirect('/');
  });
});

app.post('/login', async (req, res) => {
  const {
    username,
    password
  } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (user && await bcrypt.compare(password, user.password)) {
    req.session.user = user;
    res.redirect(user.role === 'manager' ? '/manager-dashboard.html' : '/employee-dashboard.html');
  } else {
    res.status(401).send('Invalid username or password');
  }
});

app.post('/register', async (req, res) => {
  const {
    username,
    password,
    role,
    full_name,
    employee_id,
    job_title,
    department,
    manager_name,
    home_address,
    phone_number,
    personal_email,
    site_location,
    job_grade,
    business_email,
    emergency_contact_name,
    emergency_contact_phone
  } = req.body;

  if (!username || !password || !role) {
    return res.status(400).send("Username, password, and role are required.");
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  const registerUser = db.transaction(() => {
    const userStmt = db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)');
    const info = userStmt.run(username, hashedPassword, role);
    const userId = info.lastInsertRowid;
    
    const detailsStmt = db.prepare(`
        INSERT INTO user_details (
          user_id, full_name, employee_id, job_title, department, manager_name,
          home_address, phone_number, personal_email, site_location, job_grade, business_email,
          emergency_contact_name, emergency_contact_phone
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
    detailsStmt.run(
      userId, full_name, employee_id, job_title, department, manager_name, home_address,
      phone_number, personal_email, site_location, job_grade, business_email,
      emergency_contact_name, emergency_contact_phone
    );

    // Automatically create leave balances for new employees (80 hours default)
    if (role === 'employee') {
      const leaveBalanceStmt = db.prepare(`
        INSERT INTO leave_balances (user_id, annual_leave, sick_leave, long_service_leave)
        VALUES (?, 80.0, 80.0, 0.0)
      `);
      leaveBalanceStmt.run(userId);
    }
  });

  try {
    registerUser();
    res.redirect('/admin.html');
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      res.status(409).send(`Registration failed: The username '${username}' is already in use. Please choose another.`);
    } else {
      res.status(500).send("An unexpected error occurred during registration.");
    }
  }
});

app.post('/update-user/:id', async (req, res) => {
  const userId = req.params.id;
  const {
    username,
    password,
    role,
    full_name,
    employee_id,
    job_title,
    department,
    manager_name,
    home_address,
    phone_number,
    personal_email,
    site_location,
    job_grade,
    business_email,
    emergency_contact_name,
    emergency_contact_phone
  } = req.body;

  try {
    let hashedPassword = null;
    if (password) {
      hashedPassword = await bcrypt.hash(password, 10);
    }
    const updateUserTransaction = db.transaction(() => {
      let userUpdateSql = 'UPDATE users SET username = ?, role = ?';
      const userParams = [username, role];
      if (hashedPassword) {
        userUpdateSql += ', password = ?';
        userParams.push(hashedPassword);
      }
      userUpdateSql += ' WHERE id = ?';
      userParams.push(userId);
      db.prepare(userUpdateSql).run(userParams);
      const detailsUpdateSql = `
        UPDATE user_details SET
          full_name = ?, employee_id = ?, job_title = ?, department = ?, manager_name = ?,
          home_address = ?, phone_number = ?, personal_email = ?, site_location = ?,
          job_grade = ?, business_email = ?, emergency_contact_name = ?, emergency_contact_phone = ?
        WHERE user_id = ?
      `;
      db.prepare(detailsUpdateSql).run(
        full_name, employee_id, job_title, department, manager_name, home_address,
        phone_number, personal_email, site_location, job_grade, business_email,
        emergency_contact_name, emergency_contact_phone, userId
      );
    });
    updateUserTransaction();
    res.redirect('/admin.html');
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      res.status(409).send(`Update failed: The username '${username}' is already in use by another account. Please choose a different username.`);
    } else {
      res.status(500).send("An unexpected server error occurred while updating the user.");
    }
  }
});

app.delete('/delete-user/:id', (req, res) => {
  const userId = req.params.id;
  try {
    const stmt = db.prepare('DELETE FROM users WHERE id = ?');
    const info = stmt.run(userId);
    if (info.changes > 0) {
      res.status(200).json({
        success: true,
        message: 'User deleted successfully.'
      });
    } else {
      res.status(404).json({
        success: false,
        message: 'User not found.'
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error deleting user.'
    });
  }
});

app.post('/api/leave-request', checkAuth, (req, res) => {
  const {
    leave_type,
    start_date,
    end_date,
    hours_requested,
    comments
  } = req.body;
  const userId = req.session.user.id;

  if (!leave_type || !start_date || !end_date || !hours_requested) {
    return res.status(400).json({
      success: false,
      message: 'Missing required fields.'
    });
  }

  // Validate hours_requested
  const hours = parseFloat(hours_requested);
  if (isNaN(hours) || hours <= 0) {
    return res.status(400).json({
      success: false,
      message: 'Hours requested must be a positive number.'
    });
  }

  try {
    const stmt = db.prepare('INSERT INTO leave_requests (user_id, leave_type, start_date, end_date, hours_requested, comments) VALUES (?, ?, ?, ?, ?, ?)');
    stmt.run(userId, leave_type, start_date, end_date, hours, comments);
    res.status(201).json({
      success: true,
      message: 'Leave request submitted successfully.'
    });
  } catch (error) {
    console.error('Leave request submission error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while submitting the request.'
    });
  }
});

app.get('/api/leave-requests/pending', checkAuth, (req, res) => {
  if (req.session.user.role !== 'manager') {
    return res.status(403).json({
      message: 'Forbidden'
    });
  }
  try {
    const stmt = db.prepare(`
            SELECT
                lr.id, lr.leave_type, lr.start_date, lr.end_date, lr.hours_requested, lr.comments,
                ud.full_name, lr.requested_at
            FROM leave_requests lr
            JOIN user_details ud ON lr.user_id = ud.user_id
            WHERE lr.status = 'pending'
            ORDER BY lr.requested_at ASC
        `);
    const requests = stmt.all();
    res.json(requests);
  } catch (error) {
    console.error('Fetch pending requests error:', error);
    res.status(500).json({
      message: 'Error fetching pending leave requests.'
    });
  }
});

app.get('/api/leave-requests/history', checkAuth, (req, res) => {
  const userId = req.session.user.id;
  try {
    const stmt = db.prepare(`
            SELECT leave_type, start_date, end_date, hours_requested, status, requested_at
            FROM leave_requests
            WHERE user_id = ?
            ORDER BY requested_at DESC
        `);
    const requests = stmt.all(userId);
    res.json(requests);
  } catch (error) {
    console.error('Fetch leave history error:', error);
    res.status(500).json({
      message: 'Error fetching leave request history.'
    });
  }
});

app.post('/api/leave-requests/:id/approve', checkAuth, (req, res) => {
  if (req.session.user.role !== 'manager') {
    return res.status(403).json({
      message: 'Forbidden'
    });
  }
  
  const requestId = req.params.id;
  
  try {
    // Use a transaction to ensure atomicity
    const result = db.transaction(() => {
      // First, get the leave request details
      const getRequestStmt = db.prepare(`
        SELECT user_id, leave_type, hours_requested, status 
        FROM leave_requests 
        WHERE id = ?
      `);
      const request = getRequestStmt.get(requestId);
      
      if (!request) {
        throw new Error('Request not found');
      }
      
      if (request.status !== 'pending') {
        throw new Error('Request has already been processed');
      }
      
      // Update the request status
      const updateRequestStmt = db.prepare(`
        UPDATE leave_requests 
        SET status = 'approved', approved_at = CURRENT_TIMESTAMP 
        WHERE id = ?
      `);
      updateRequestStmt.run(requestId);
      
      // Deduct hours from leave balance (only for paid leave types)
      if (['annual', 'sick', 'long_service'].includes(request.leave_type)) {
        let balanceField = '';
        switch (request.leave_type) {
          case 'annual':
            balanceField = 'annual_leave';
            break;
          case 'sick':
            balanceField = 'sick_leave';
            break;
          case 'long_service':
            balanceField = 'long_service_leave';
            break;
        }
        
        // Check if user has leave balance record
        const checkBalanceStmt = db.prepare(`
          SELECT ${balanceField} FROM leave_balances WHERE user_id = ?
        `);
        const currentBalance = checkBalanceStmt.get(request.user_id);
        
        if (!currentBalance) {
          throw new Error('Employee leave balance not found');
        }
        
        const newBalance = currentBalance[balanceField] - request.hours_requested;
        
        if (newBalance < 0) {
          throw new Error(`Insufficient ${request.leave_type} leave balance`);
        }
        
        // Update the leave balance
        const updateBalanceStmt = db.prepare(`
          UPDATE leave_balances 
          SET ${balanceField} = ?, updated_at = CURRENT_TIMESTAMP 
          WHERE user_id = ?
        `);
        updateBalanceStmt.run(newBalance, request.user_id);
      }
      
      return { 
        success: true, 
        hoursDeducted: request.hours_requested,
        leaveType: request.leave_type 
      };
    })();
    
    res.json({
      success: true,
      message: result.leaveType === 'unpaid' || result.leaveType === 'other' 
        ? 'Request approved.' 
        : `Request approved. ${result.hoursDeducted} hours deducted from ${result.leaveType} leave balance.`
    });
    
  } catch (error) {
    console.error('Approve request error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error approving request.'
    });
  }
});

app.post('/api/leave-requests/:id/deny', checkAuth, (req, res) => {
  if (req.session.user.role !== 'manager') {
    return res.status(403).json({
      message: 'Forbidden'
    });
  }
  try {
    const stmt = db.prepare("UPDATE leave_requests SET status = 'denied' WHERE id = ?");
    const info = stmt.run(req.params.id);
    if (info.changes > 0) {
      res.json({
        success: true,
        message: 'Request denied.'
      });
    } else {
      res.status(404).json({
        success: false,
        message: 'Request not found.'
      });
    }
  } catch (error) {
    console.error('Deny request error:', error);
    res.status(500).json({
      message: 'Error denying request.'
    });
  }
});


// --- Shift Swap Endpoints ---
app.post('/api/shift-swap/request', checkAuth, (req, res) => {
    const { requester_shift, requested_shift, requested_with_id } = req.body;
    const requester_id = req.session.user.id;

    if (!requester_shift || !requested_shift) {
        return res.status(400).json({ success: false, message: 'Both of your shifts must be specified.' });
    }

    try {
        const stmt = db.prepare('INSERT INTO shift_swaps (requester_id, requester_shift, requested_shift, requested_with_id) VALUES (?, ?, ?, ?)');
        stmt.run(requester_id, requester_shift, requested_shift, requested_with_id || null);
        res.status(201).json({ success: true, message: 'Shift swap request submitted successfully.' });
    } catch (error) {
        console.error('Shift swap request submission error:', error);
        res.status(500).json({ success: false, message: 'An error occurred while submitting the request.' });
    }
});

app.get('/api/shift-swap/requests', checkAuth, (req, res) => {
    try {
        const currentUserId = req.session.user.id;

        const outgoingStmt = db.prepare(`
            SELECT ss.id, ss.requester_shift, ss.requested_shift, ud.full_name as with_colleague, ss.status
            FROM shift_swaps ss
            LEFT JOIN user_details ud ON ss.requested_with_id = ud.user_id
            WHERE ss.requester_id = ?
        `);
        const outgoing = outgoingStmt.all(currentUserId);

        const availableStmt = db.prepare(`
            SELECT ss.id, ss.requester_shift, ss.requested_shift, ud.full_name as from_colleague, ss.status
            FROM shift_swaps ss
            JOIN user_details ud ON ss.requester_id = ud.user_id
            WHERE (ss.requested_with_id IS NULL OR ss.requested_with_id = ?) AND ss.requester_id != ? AND ss.status = 'pending'
        `);
        const available = availableStmt.all(currentUserId, currentUserId);

        res.json({ outgoing, available });
    } catch (error) {
        console.error('Fetch shift swap requests error:', error);
        res.status(500).json({ message: 'Error fetching shift swap requests.' });
    }
});


app.post('/api/shift-swap/:id/accept', checkAuth, (req, res) => {
    const swapId = req.params.id;
    const accepterId = req.session.user.id;
    try {
        const swap = db.prepare("SELECT * FROM shift_swaps WHERE id = ? AND status = 'pending'").get(swapId);
        if (!swap) {
            return res.status(404).json({ success: false, message: 'Shift swap not found or already actioned.' });
        }
        if (swap.requester_id === accepterId) {
            return res.status(403).json({ success: false, message: 'You cannot accept your own shift swap request.' });
        }

        const stmt = db.prepare("UPDATE shift_swaps SET status = 'accepted', accepter_id = ? WHERE id = ?");
        const info = stmt.run(accepterId, swapId);
        if (info.changes > 0) {
            res.json({ success: true, message: 'Shift swap accepted. It has been sent to the manager for approval.' });
        } else {
            res.status(404).json({ success: false, message: 'Shift swap not found.' });
        }
    } catch (error) {
        console.error('Accept shift swap error:', error);
        res.status(500).json({ message: 'Error accepting shift swap.' });
    }
});

app.get('/api/shift-swap/accepted', checkAuth, (req, res) => {
    if (req.session.user.role !== 'manager') {
        return res.status(403).json({ message: 'Forbidden' });
    }
    try {
        const stmt = db.prepare(`
            SELECT
                ss.id,
                requester.full_name as requester_name,
                ss.requester_shift,
                accepter.full_name as accepter_name,
                ss.requested_shift
            FROM shift_swaps ss
            JOIN user_details requester ON ss.requester_id = requester.user_id
            JOIN user_details accepter ON ss.accepter_id = accepter.user_id
            WHERE ss.status = 'accepted'
        `);
        const requests = stmt.all();
        res.json(requests);
    } catch (error) {
        console.error('Fetch accepted shift swaps error:', error);
        res.status(500).json({ message: 'Error fetching accepted shift swaps.' });
    }
});

app.post('/api/shift-swap/:id/approve', checkAuth, (req, res) => {
    if (req.session.user.role !== 'manager') {
        return res.status(403).json({ message: 'Forbidden' });
    }
    try {
        const stmt = db.prepare("UPDATE shift_swaps SET status = 'approved' WHERE id = ? AND status = 'accepted'");
        const info = stmt.run(req.params.id);
        if (info.changes > 0) {
            res.json({ success: true, message: 'Request approved.' });
        } else {
            res.status(404).json({ success: false, message: 'Request not found or not in accepted state.' });
        }
    } catch (error) {
        console.error('Approve request error:', error);
        res.status(500).json({ message: 'Error approving request.' });
    }
});

app.post('/api/shift-swap/:id/deny', checkAuth, (req, res) => {
    if (req.session.user.role !== 'manager') {
        return res.status(403).json({ message: 'Forbidden' });
    }
    try {
        const stmt = db.prepare("UPDATE shift_swaps SET status = 'denied' WHERE id = ? AND status = 'accepted'");
        const info = stmt.run(req.params.id);
        if (info.changes > 0) {
            res.json({ success: true, message: 'Request denied.' });
        } else {
            res.status(404).json({ success: false, message: 'Request not found or not in accepted state.' });
        }
    } catch (error) {
        console.error('Deny request error:', error);
        res.status(500).json({ message: 'Error denying request.' });
    }
});

app.post('/api/shift-swap/:id/withdraw', checkAuth, (req, res) => {
    const swapId = req.params.id;
    const currentUserId = req.session.user.id;
    try {
        const stmt = db.prepare("DELETE FROM shift_swaps WHERE id = ? AND requester_id = ? AND status = 'pending'");
        const info = stmt.run(swapId, currentUserId);
        if (info.changes > 0) {
            res.json({ success: true, message: 'Request withdrawn.' });
        } else {
            res.status(404).json({ success: false, message: 'Request not found or cannot be withdrawn.' });
        }
    } catch (error) {
        console.error('Withdraw request error:', error);
        res.status(500).json({ message: 'Error withdrawing request.' });
    }
});

app.get('/api/shift-swap/history', checkAuth, (req, res) => {
    const currentUserId = req.session.user.id;
    try {
        const stmt = db.prepare(`
            SELECT
                ss.id,
                ss.status,
                ss.requester_id,
                ss.accepter_id,
                requester.full_name as requester_name,
                accepter.full_name as accepter_name,
                ss.requester_shift,
                ss.requested_shift
            FROM shift_swaps ss
            JOIN user_details requester ON ss.requester_id = requester.user_id
            LEFT JOIN user_details accepter ON ss.accepter_id = accepter.user_id
            WHERE (ss.requester_id = ? OR ss.accepter_id = ?)
            AND ss.status IN ('approved', 'denied')
            ORDER BY ss.id DESC
            LIMIT 3
        `);
        const history = stmt.all(currentUserId, currentUserId);

        const processedHistory = history.map(swap => {
            const isRequester = swap.requester_id === currentUserId;
            return {
                my_role: isRequester ? 'Requester' : 'Accepter',
                my_shift: isRequester ? swap.requester_shift : swap.requested_shift,
                colleague_name: isRequester ? swap.accepter_name : swap.requester_name,
                colleague_shift: isRequester ? swap.requested_shift : swap.requester_shift,
                status: swap.status
            };
        });

        res.json(processedHistory);
    } catch (error) {
        console.error('Fetch shift swap history error:', error);
        res.status(500).json({ message: 'Error fetching shift swap history.' });
    }
});

// ===== SCHEDULE MANAGEMENT API =====

// Get all employees for schedule management (for managers only)
app.get('/api/schedule/employees', checkAuth, (req, res) => {
    try {
        if (req.session.user.role !== 'manager') {
            return res.status(403).json({ message: 'Access denied. Manager role required.' });
        }
        
        const stmt = db.prepare(`
            SELECT u.id, u.username, ud.full_name, ud.job_title, ud.department 
            FROM users u 
            LEFT JOIN user_details ud ON u.id = ud.user_id 
            WHERE u.role = 'employee'
            ORDER BY ud.full_name ASC
        `);
        res.json(stmt.all());
    } catch (error) {
        console.error('Error fetching employees for schedule:', error);
        res.status(500).json({ message: 'Database error' });
    }
});

// Get schedule for a specific week
app.get('/api/schedule/:weekStart', checkAuth, (req, res) => {
    try {
        const weekStart = req.params.weekStart;
        const stmt = db.prepare(`
            SELECT 
                es.user_id,
                es.day_of_week,
                es.shift_start_time,
                es.shift_end_time,
                es.shift_type,
                ud.full_name
            FROM employee_schedules es
            JOIN user_details ud ON es.user_id = ud.user_id
            WHERE es.week_start_date = ?
            ORDER BY ud.full_name ASC, es.day_of_week ASC
        `);
        res.json(stmt.all(weekStart));
    } catch (error) {
        console.error('Error fetching schedule:', error);
        res.status(500).json({ message: 'Database error' });
    }
});

// Update/Set employee schedule
app.post('/api/schedule/update', checkAuth, (req, res) => {
    try {
        if (req.session.user.role !== 'manager') {
            return res.status(403).json({ message: 'Access denied. Manager role required.' });
        }

        const { userId, weekStart, dayOfWeek, shiftStartTime, shiftEndTime, shiftType } = req.body;

        // Delete existing schedule for this user, week, and day
        const deleteStmt = db.prepare(`
            DELETE FROM employee_schedules 
            WHERE user_id = ? AND week_start_date = ? AND day_of_week = ?
        `);
        deleteStmt.run(userId, weekStart, dayOfWeek);

        // Insert new schedule if shift times are provided
        if (shiftStartTime && shiftEndTime) {
            const insertStmt = db.prepare(`
                INSERT INTO employee_schedules (user_id, week_start_date, day_of_week, shift_start_time, shift_end_time, shift_type, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            `);
            insertStmt.run(userId, weekStart, dayOfWeek, shiftStartTime, shiftEndTime, shiftType || 'regular');
        }

        res.json({ success: true, message: 'Schedule updated successfully' });
    } catch (error) {
        console.error('Error updating schedule:', error);
        res.status(500).json({ message: 'Database error' });
    }
});

// Get schedule pattern for an employee
app.get('/api/schedule/pattern/:userId', checkAuth, (req, res) => {
    try {
        if (req.session.user.role !== 'manager') {
            return res.status(403).json({ message: 'Access denied. Manager role required.' });
        }

        const userId = req.params.userId;
        const stmt = db.prepare(`
            SELECT pattern_weeks FROM employee_schedule_patterns 
            WHERE user_id = ? AND is_active = 1
        `);
        const pattern = stmt.get(userId);
        
        res.json({ pattern_weeks: pattern ? pattern.pattern_weeks : 1 });
    } catch (error) {
        console.error('Error fetching schedule pattern:', error);
        res.status(500).json({ message: 'Database error' });
    }
});

// Set schedule pattern for an employee
app.post('/api/schedule/pattern', checkAuth, (req, res) => {
    try {
        if (req.session.user.role !== 'manager') {
            return res.status(403).json({ message: 'Access denied. Manager role required.' });
        }

        const { userId, patternWeeks } = req.body;

        // Deactivate existing patterns
        const deactivateStmt = db.prepare(`
            UPDATE employee_schedule_patterns 
            SET is_active = 0 
            WHERE user_id = ?
        `);
        deactivateStmt.run(userId);

        // Insert new pattern
        const insertStmt = db.prepare(`
            INSERT INTO employee_schedule_patterns (user_id, pattern_weeks, is_active)
            VALUES (?, ?, 1)
        `);
        insertStmt.run(userId, patternWeeks);

        res.json({ success: true, message: 'Schedule pattern updated successfully' });
    } catch (error) {
        console.error('Error updating schedule pattern:', error);
        res.status(500).json({ message: 'Database error' });
    }
});

// Get schedule for a specific week with pattern support
app.get('/api/schedule/employee/:userId/:weekStart', checkAuth, (req, res) => {
    try {
        const { userId, weekStart } = req.params;
        
        console.log(`DEBUG: Fetching schedule for user ${userId}, week ${weekStart}`);
        
        // Get employee's pattern
        const patternStmt = db.prepare(`
            SELECT pattern_weeks FROM employee_schedule_patterns 
            WHERE user_id = ? AND is_active = 1
        `);
        const pattern = patternStmt.get(userId);
        const patternWeeks = pattern ? pattern.pattern_weeks : 1;
        
        console.log(`DEBUG: Pattern weeks for user ${userId}:`, patternWeeks);

        // Get all schedules for this employee's pattern
        const schedules = [];
        const baseDate = new Date(weekStart);
        
        for (let week = 0; week < patternWeeks; week++) {
            const currentWeek = new Date(baseDate);
            currentWeek.setDate(currentWeek.getDate() + (week * 7));
            const currentWeekStr = currentWeek.toISOString().split('T')[0];
            
            console.log(`DEBUG: Checking week ${week}, date ${currentWeekStr}`);
            
            const stmt = db.prepare(`
                SELECT 
                    es.user_id,
                    es.day_of_week,
                    es.shift_start_time,
                    es.shift_end_time,
                    es.shift_type,
                    ? as week_offset,
                    ? as week_start_date
                FROM employee_schedules es
                WHERE es.user_id = ? AND es.week_start_date = ?
                ORDER BY es.day_of_week ASC
            `);
            const weekSchedules = stmt.all(week, currentWeekStr, userId, currentWeekStr);
            console.log(`DEBUG: Found ${weekSchedules.length} schedules for week ${currentWeekStr}`);
            schedules.push(...weekSchedules);
        }
        
        console.log(`DEBUG: Total schedules found:`, schedules.length);
        res.json({ schedules, pattern_weeks: patternWeeks });
    } catch (error) {
        console.error('Error fetching employee schedule:', error);
        res.status(500).json({ message: 'Database error' });
    }
});


// Clear employee schedule for a specific day
app.delete('/api/schedule/clear', checkAuth, (req, res) => {
    try {
        if (req.session.user.role !== 'manager') {
            return res.status(403).json({ message: 'Access denied. Manager role required.' });
        }

        const { userId, weekStart, dayOfWeek } = req.body;
        
        const stmt = db.prepare(`
            DELETE FROM employee_schedules 
            WHERE user_id = ? AND week_start_date = ? AND day_of_week = ?
        `);
        const result = stmt.run(userId, weekStart, dayOfWeek);

        res.json({ success: true, message: 'Schedule cleared successfully', changes: result.changes });
    } catch (error) {
        console.error('Error clearing schedule:', error);
        res.status(500).json({ message: 'Database error' });
    }
});

// Leave Balances API Endpoints

// Get all employee leave balances (for managers)
app.get('/api/leave-balances', checkAuth, (req, res) => {
    if (req.session.user.role !== 'manager') {
        return res.status(403).json({ message: 'Manager access required' });
    }

    try {
        const stmt = db.prepare(`
            SELECT 
                lb.user_id,
                u.username,
                ud.full_name,
                lb.annual_leave,
                lb.sick_leave,
                lb.long_service_leave,
                lb.updated_at
            FROM leave_balances lb
            JOIN users u ON lb.user_id = u.id
            LEFT JOIN user_details ud ON u.id = ud.user_id
            WHERE u.role = 'employee'
            ORDER BY ud.full_name, u.username
        `);
        
        const balances = stmt.all();
        res.json({ balances });
    } catch (error) {
        console.error('Error fetching leave balances:', error);
        res.status(500).json({ message: 'Database error' });
    }
});

// Get individual employee leave balance
app.get('/api/leave-balances/:userId', checkAuth, (req, res) => {
    const { userId } = req.params;
    const currentUserId = req.session.user.id;
    const currentUserRole = req.session.user.role;

    // Allow access if manager or if employee is viewing their own balance
    if (currentUserRole !== 'manager' && parseInt(userId) !== currentUserId) {
        return res.status(403).json({ message: 'Access denied' });
    }

    try {
        let stmt = db.prepare(`
            SELECT 
                lb.user_id,
                u.username,
                ud.full_name,
                lb.annual_leave,
                lb.sick_leave,
                lb.long_service_leave,
                lb.updated_at
            FROM leave_balances lb
            JOIN users u ON lb.user_id = u.id
            LEFT JOIN user_details ud ON u.id = ud.user_id
            WHERE lb.user_id = ?
        `);
        
        let balance = stmt.get(userId);
        
        // If no balance record exists, create one with defaults
        if (!balance) {
            const insertStmt = db.prepare(`
                INSERT INTO leave_balances (user_id, annual_leave, sick_leave, long_service_leave)
                VALUES (?, 80.0, 80.0, 0.0)
            `);
            insertStmt.run(userId);
            
            // Fetch the newly created record
            balance = stmt.get(userId);
        }
        
        res.json({ balance });
    } catch (error) {
        console.error('Error fetching leave balance:', error);
        res.status(500).json({ message: 'Database error' });
    }
});

// Update employee leave balance (managers only)
app.put('/api/leave-balances/:userId', checkAuth, (req, res) => {
    if (req.session.user.role !== 'manager') {
        return res.status(403).json({ message: 'Manager access required' });
    }

    const { userId } = req.params;
    const { annual_leave, sick_leave, long_service_leave } = req.body;

    if (annual_leave === undefined || sick_leave === undefined || long_service_leave === undefined) {
        return res.status(400).json({ message: 'All leave balance fields are required' });
    }

    try {
        // First ensure user exists and is an employee
        const userStmt = db.prepare('SELECT id, role FROM users WHERE id = ?');
        const user = userStmt.get(userId);
        
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        
        if (user.role !== 'employee') {
            return res.status(400).json({ message: 'Can only update employee leave balances' });
        }

        // Insert or update leave balance
        const updateStmt = db.prepare(`
            INSERT INTO leave_balances (user_id, annual_leave, sick_leave, long_service_leave, updated_at)
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(user_id) DO UPDATE SET
                annual_leave = excluded.annual_leave,
                sick_leave = excluded.sick_leave,
                long_service_leave = excluded.long_service_leave,
                updated_at = CURRENT_TIMESTAMP
        `);
        
        updateStmt.run(userId, parseFloat(annual_leave), parseFloat(sick_leave), parseFloat(long_service_leave));
        
        res.json({ success: true, message: 'Leave balance updated successfully' });
    } catch (error) {
        console.error('Error updating leave balance:', error);
        res.status(500).json({ message: 'Database error' });
    }
});

// Get employee work schedule for leave calculation
app.get('/api/schedule/work-pattern/:userId', checkAuth, (req, res) => {
    const { userId } = req.params;
    const currentUserId = req.session.user.id;
    const currentUserRole = req.session.user.role;

    // Allow access if manager or if employee is viewing their own schedule
    if (currentUserRole !== 'manager' && parseInt(userId) !== currentUserId) {
        return res.status(403).json({ message: 'Access denied' });
    }

    try {
        // Get the employee's schedule pattern
        const patternStmt = db.prepare(`
            SELECT pattern_weeks, is_active 
            FROM employee_schedule_patterns 
            WHERE user_id = ? AND is_active = 1
        `);
        const pattern = patternStmt.get(userId);

        if (!pattern) {
            return res.json({ 
                success: false, 
                message: 'No active schedule pattern found',
                workDays: []
            });
        }

        // Get all schedule entries for this employee
        const scheduleStmt = db.prepare(`
            SELECT 
                day_of_week,
                shift_start_time,
                shift_end_time,
                shift_type,
                week_offset
            FROM employee_schedules 
            WHERE user_id = ?
            ORDER BY week_offset, day_of_week
        `);
        const schedules = scheduleStmt.all(userId);

        // Calculate hours per shift
        const workDays = schedules.map(schedule => {
            let hours = 0;
            if (schedule.shift_type !== 'leave' && schedule.shift_start_time && schedule.shift_end_time) {
                const start = parseTime(schedule.shift_start_time);
                const end = parseTime(schedule.shift_end_time);
                hours = calculateHoursBetween(start, end);
            }
            
            return {
                dayOfWeek: schedule.day_of_week,
                weekOffset: schedule.week_offset || 0,
                shiftType: schedule.shift_type,
                startTime: schedule.shift_start_time,
                endTime: schedule.shift_end_time,
                hours: hours
            };
        });

        res.json({
            success: true,
            patternWeeks: pattern.pattern_weeks,
            workDays: workDays
        });

    } catch (error) {
        console.error('Error fetching work pattern:', error);
        res.status(500).json({ message: 'Database error' });
    }
});

// Helper function to parse time string (HH:MM)
function parseTime(timeStr) {
    const [hours, minutes] = timeStr.split(':').map(Number);
    return hours + (minutes / 60);
}

// Helper function to calculate hours between two times
function calculateHoursBetween(startHours, endHours) {
    let diff = endHours - startHours;
    if (diff < 0) diff += 24; // Handle overnight shifts
    return Math.round(diff * 2) / 2; // Round to nearest 0.5
}

app.listen(port, () => {
  console.log(`Brendilka Time Manager is now live on port ${port}`);
});