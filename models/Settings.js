const mongoose = require('mongoose');

const settingsSchema = new mongoose.Schema({
    key: {
        type: String,
        required: true,
        unique: true
    },
    value: {
        type: mongoose.Schema.Types.Mixed,
        required: true
    },
    description: {
        type: String,
        default: ''
    },
    type: {
        type: String,
        enum: ['boolean', 'string', 'number', 'object'],
        default: 'string'
    }
}, {
    timestamps: true
});

// Static method to get setting by key
settingsSchema.statics.getSetting = function(key, defaultValue = null) {
    return this.findOne({ key }).then(setting => setting ? setting.value : defaultValue);
};

// Static method to set setting
settingsSchema.statics.setSetting = function(key, value, description = '', type = 'string') {
    return this.findOneAndUpdate(
        { key },
        { value, description, type },
        { upsert: true, new: true }
    );
};

module.exports = mongoose.model('Settings', settingsSchema);