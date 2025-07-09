// --- Package Management Endpoints ---
app.get('/api/packages', async (req, res) => {
    try {
        const packages = await Package.find().sort({ price: 1 });
        res.json(packages);
    } catch (error) {
        res.status(500).json({ message: 'Failed to fetch packages' });
    }
});

app.post('/api/packages', async (req, res) => {
    try {
        const newPackage = new Package(req.body);
        await newPackage.save();
        res.status(201).json(newPackage);
    } catch (error) {
        res.status(500).json({ message: 'Failed to create package' });
    }
});

app.put('/api/packages/:id', async (req, res) => {
    try {
        const updatedPackage = await Package.findByIdAndUpdate(req.params.id, req.body, { new: true });
        res.json(updatedPackage);
    } catch (error) {
        res.status(500).json({ message: 'Failed to update package' });
    }
});

app.delete('/api/packages/:id', async (req, res) => {
    try {
        await Package.findByIdAndDelete(req.params.id);
        res.status(204).send();
    } catch (error) {
        res.status(500).json({ message: 'Failed to delete package' });
    }
});


// --- Dashboard Stats Endpoint ---
app.get('/api/stats/dashboard', async (req, res) => {
  try {
    const totalKeys = await Key.countDocuments();
    const activeKeys = await Key.countDocuments({ isActive: true });
    const totalRevenue = await Transaction.aggregate([
      { $match: { status: 'Success' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    res.json({
      totalKeys,
      activeKeys,
      totalRevenue: totalRevenue[0]?.total || 0,
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch dashboard stats' });
  }
});


// AI Proxy Endpoint