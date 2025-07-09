const jwt = require('jsonwebtoken');

// Middleware xác thực admin
const isAdmin = (req, res, next) => {
  try {
    // Lấy token từ header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        success: false, 
        message: 'Access token required' 
      });
    }

    const token = authHeader.substring(7); // Bỏ 'Bearer ' prefix
    
    // Verify token (thay YOUR_ADMIN_SECRET bằng secret thực tế)
    const decoded = jwt.verify(token, process.env.ADMIN_JWT_SECRET || 'your_admin_secret');
    
    // Kiểm tra role admin
    if (decoded.role !== 'admin') {
      return res.status(403).json({ 
        success: false, 
        message: 'Admin access required' 
      });
    }

    req.admin = decoded;
    next();
  } catch (error) {
    console.error('Admin auth error:', error);
    return res.status(401).json({ 
      success: false, 
      message: 'Invalid or expired token' 
    });
  }
};

// Middleware xác thực user (cho các route AI proxy)
const authenticateUser = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        success: false, 
        message: 'User token required' 
      });
    }

    const token = authHeader.substring(7);
    
    // Verify user token (sử dụng cùng secret với key validation)
    const decoded = jwt.verify(token, process.env.USER_JWT_SECRET || 'your_user_secret');
    
    req.user = decoded;
    next();
  } catch (error) {
    console.error('User auth error:', error);
    return res.status(401).json({ 
      success: false, 
      message: 'Invalid or expired user token' 
    });
  }
};

module.exports = { isAdmin, authenticateUser }; 