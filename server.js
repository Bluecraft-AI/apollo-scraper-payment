const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;

// Middleware
app.use(express.json());
app.use(express.static('.'));

// Store active monitoring processes
const activeMonitors = new Map();

// Serve the main HTML file
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Start background monitoring endpoint
app.post('/start-monitor', (req, res) => {
    const { runId } = req.body;
    
    if (!runId) {
        return res.status(400).json({ error: 'Run ID is required' });
    }

    try {
        console.log(`🚀 Starting background monitor for run: ${runId}`);
        
        // Check if monitor is already running for this run ID
        if (activeMonitors.has(runId)) {
            console.log(`⚠️ Monitor already running for run: ${runId}`);
            return res.json({ 
                success: true, 
                message: 'Monitor already running',
                runId: runId 
            });
        }

        // Start the background monitor process
        const monitorProcess = spawn('node', ['background-monitor.js', runId], {
            detached: true,
            stdio: ['ignore', 'pipe', 'pipe']
        });

        // Store the process
        activeMonitors.set(runId, {
            process: monitorProcess,
            startTime: new Date(),
            runId: runId
        });

        // Handle process output
        monitorProcess.stdout.on('data', (data) => {
            console.log(`📊 Monitor ${runId}: ${data.toString().trim()}`);
        });

        monitorProcess.stderr.on('data', (data) => {
            console.error(`❌ Monitor ${runId} error: ${data.toString().trim()}`);
        });

        // Handle process completion
        monitorProcess.on('close', (code) => {
            console.log(`✅ Monitor ${runId} completed with code: ${code}`);
            activeMonitors.delete(runId);
        });

        monitorProcess.on('error', (error) => {
            console.error(`❌ Monitor ${runId} failed to start:`, error);
            activeMonitors.delete(runId);
        });

        // Detach the process so it runs independently
        monitorProcess.unref();

        console.log(`✅ Background monitor started successfully for run: ${runId}`);
        
        res.json({ 
            success: true, 
            message: 'Background monitor started successfully',
            runId: runId,
            pid: monitorProcess.pid
        });

    } catch (error) {
        console.error(`❌ Failed to start monitor for run ${runId}:`, error);
        res.status(500).json({ 
            error: 'Failed to start background monitor',
            details: error.message 
        });
    }
});

// Get status of all active monitors
app.get('/monitor-status', (req, res) => {
    const status = Array.from(activeMonitors.entries()).map(([runId, info]) => ({
        runId: runId,
        startTime: info.startTime,
        pid: info.process.pid,
        running: !info.process.killed
    }));

    res.json({
        activeMonitors: status.length,
        monitors: status
    });
});

// Stop a specific monitor
app.post('/stop-monitor', (req, res) => {
    const { runId } = req.body;
    
    if (!activeMonitors.has(runId)) {
        return res.status(404).json({ error: 'Monitor not found for this run ID' });
    }

    try {
        const monitorInfo = activeMonitors.get(runId);
        monitorInfo.process.kill();
        activeMonitors.delete(runId);
        
        console.log(`🛑 Stopped monitor for run: ${runId}`);
        res.json({ success: true, message: `Monitor stopped for run: ${runId}` });
    } catch (error) {
        console.error(`❌ Failed to stop monitor for run ${runId}:`, error);
        res.status(500).json({ error: 'Failed to stop monitor' });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        activeMonitors: activeMonitors.size,
        uptime: process.uptime()
    });
});

// Start the server
app.listen(PORT, () => {
    console.log(`🚀 Apollo Scraper Server running on http://localhost:${PORT}`);
    console.log(`📊 Active monitors: ${activeMonitors.size}`);
    console.log(`🔧 Background monitoring: Enabled`);
    console.log(`📝 Logs: Check monitor.log for detailed monitoring logs`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down server...');
    
    // Stop all active monitors
    for (const [runId, info] of activeMonitors) {
        try {
            info.process.kill();
            console.log(`🛑 Stopped monitor for run: ${runId}`);
        } catch (error) {
            console.error(`❌ Error stopping monitor ${runId}:`, error);
        }
    }
    
    process.exit(0);
}); 