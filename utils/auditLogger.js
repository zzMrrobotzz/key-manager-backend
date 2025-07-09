const AuditLog = require('../models/AuditLog');

const createAuditLog = async (action, details = '', actor = 'System') => {
  try {
    const log = new AuditLog({ action, details, actor });
    await log.save();
  } catch (error) {
    console.error('Failed to create audit log:', error);
  }
};

module.exports = { createAuditLog }; 