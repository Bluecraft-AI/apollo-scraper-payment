const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const fs = require('fs');
const path = require('path');

const TEMP_DIR = '/tmp/apollo-urls';
const PROCESSED_DIR = '/tmp/processed-sessions';

// Create processed sessions directory if it doesn't exist
function ensureProcessedDir() {
    if (!fs.existsSync(PROCESSED_DIR)) {
        fs.mkdirSync(PROCESSED_DIR, { recursive: true });
    }
}

// Check if a session has already been processed
function isSessionProcessed(sessionId) {
    ensureProcessedDir();
    const filePath = path.join(PROCESSED_DIR, `${sessionId}.processed`);
    return fs.existsSync(filePath);
}

// Mark a session as processed
function markSessionProcessed(sessionId) {
    ensureProcessedDir();
    const filePath = path.join(PROCESSED_DIR, `${sessionId}.processed`);
    fs.writeFileSync(filePath, JSON.stringify({
        sessionId: sessionId,
        processedAt: new Date().toISOString(),
        timestamp: Date.now()
    }));
}

function retrieveApolloUrl(sessionId) {
    try {
        console.log(`🔍 Attempting to retrieve Apollo URL for session: ${sessionId}`);
        console.log(`🔍 Looking in directory: ${TEMP_DIR}`);
        
        const filePath = path.join(TEMP_DIR, `${sessionId}.json`);
        console.log(`🔍 Full file path: ${filePath}`);
        console.log(`🔍 File exists: ${fs.existsSync(filePath)}`);
        
        if (fs.existsSync(filePath)) {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            console.log(`✅ Retrieved full Apollo URL for session ${sessionId}`);
            console.log(`📊 URL length: ${data.apolloUrl ? data.apolloUrl.length : 'undefined'} characters`);
            return data;
        } else {
            console.log(`❌ No stored data found for session ${sessionId}`);
            
            // List what files ARE in the temp directory
            try {
                if (fs.existsSync(TEMP_DIR)) {
                    const files = fs.readdirSync(TEMP_DIR);
                    console.log(`🔍 Files in temp directory: ${JSON.stringify(files)}`);
                } else {
                    console.log(`🔍 Temp directory doesn't exist: ${TEMP_DIR}`);
                }
            } catch (listError) {
                console.log(`🔍 Error listing temp directory: ${listError.message}`);
            }
            
            return null;
        }
    } catch (error) {
        console.error(`❌ Error retrieving Apollo URL for session ${sessionId}:`, error);
        return null;
    }
}

function cleanupApolloUrl(sessionId) {
    try {
        const filePath = path.join(TEMP_DIR, `${sessionId}.json`);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            console.log(`Cleaned up stored data for session ${sessionId}`);
        }
    } catch (error) {
        console.error(`Error cleaning up session ${sessionId}:`, error);
    }
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const sig = req.headers['stripe-signature'];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;
    let rawBody;

    try {
        // Read raw body as Buffer for signature verification
        const chunks = [];
        for await (const chunk of req) {
            chunks.push(chunk);
        }
        rawBody = Buffer.concat(chunks);

        console.log('Raw body type:', typeof rawBody);
        console.log('Raw body length:', rawBody.length);

        // Verify webhook signature with raw body
        event = stripe.webhooks.constructEvent(rawBody, sig, endpointSecret);
        console.log('Webhook signature verified successfully for event:', event.type);
    } catch (err) {
        console.error('Webhook signature verification failed:', err.message);
        return res.status(400).json({ error: `Webhook signature verification failed: ${err.message}` });
    }

    // Handle the event
    switch (event.type) {
        case 'checkout.session.completed':
            console.log(`🎯 Processing checkout.session.completed for session: ${event.data.object.id}`);
            console.log(`🎯 Event ID: ${event.id}`);
            console.log(`🎯 Created timestamp: ${new Date(event.created * 1000).toISOString()}`);
            await handleSuccessfulPayment(event.data.object);
            break;
        case 'payment_intent.succeeded':
            console.log('Payment intent succeeded:', event.data.object.id);
            break;
        case 'payment_intent.payment_failed':
            console.log('Payment failed:', event.data.object.id);
            break;
        default:
            console.log(`Unhandled event type: ${event.type}`);
    }

    res.status(200).json({ received: true });
}

async function handleSuccessfulPayment(session) {
    try {
        console.log('Processing successful payment:', session.id);
        
        // Check if the session has already been processed
        if (isSessionProcessed(session.id)) {
            console.log(`⚠️ Session ${session.id} has already been processed`);
            return;
        }
        
        // Retrieve the full Apollo URL and order details from storage
        let storedData = retrieveApolloUrl(session.id);
        
        if (!storedData) {
            console.error('No stored Apollo URL found for session:', session.id);
            // Fallback to metadata - try to reconstruct from chunks first, then use truncated
            const { leads, apolloUrl, email, cleanOutput, urlChunkCount } = session.metadata;
            if (!leads || !email) {
                console.error('Missing required metadata in session:', session.id);
                return;
            }
            
            let fullApolloUrl = apolloUrl; // Default to truncated
            
            if (urlChunkCount) {
                try {
                    const chunkCount = parseInt(urlChunkCount);
                    console.log(`🔍 Reconstructing URL from ${chunkCount} chunks`);
                    
                    // Reconstruct base64 from chunks
                    let reconstructedBase64 = '';
                    for (let i = 0; i < chunkCount; i++) {
                        const chunkKey = `urlChunk${i}`;
                        const chunk = session.metadata[chunkKey];
                        if (chunk) {
                            reconstructedBase64 += chunk;
                        } else {
                            throw new Error(`Missing chunk ${i}`);
                        }
                    }
                    
                    // Decode from base64
                    fullApolloUrl = Buffer.from(reconstructedBase64, 'base64').toString();
                    console.log(`✅ Reconstructed full Apollo URL from ${chunkCount} chunks (${fullApolloUrl.length} characters)`);
                } catch (decodeError) {
                    console.log('⚠️ Failed to reconstruct URL from chunks, using truncated version:', decodeError.message);
                }
            } else {
                console.log('⚠️ No URL chunks found, using truncated URL from metadata as fallback');
            }
            
            storedData = { apolloUrl: fullApolloUrl, email, leads, cleanOutput };
        } else {
            console.log(`Retrieved full Apollo URL (${storedData.apolloUrl.length} characters) for session ${session.id}`);
        }
        
        const { apolloUrl, email, leads, cleanOutput } = storedData;

        // Generate a random filename for this order
        const fileName = generateRandomFileName();
        
        console.log(`Starting Apollo scraper for paid order:`, {
            sessionId: session.id,
            email: email,
            leads: leads,
            fileName: fileName,
            amount: session.amount_total / 100,
            urlLength: apolloUrl.length
        });

        // Trigger Apollo scraper with FULL URL
        const runId = await triggerApolloScraper({
            url: apolloUrl,
            totalRecords: parseInt(leads),
            fileName: fileName,
            email: email,
            cleanOutput: cleanOutput === 'true',
            paymentSessionId: session.id,
            paidAmount: session.amount_total / 100
        });

        // Send email webhook notification (matching the form's behavior)
        await sendEmailWebhook(email, parseInt(leads), apolloUrl, fileName);

        console.log(`Apollo scraper triggered successfully for payment ${session.id}`);
        
        // Clean up the stored data after successful processing
        cleanupApolloUrl(session.id);

        // Mark the session as processed
        markSessionProcessed(session.id);

    } catch (error) {
        console.error('Error processing successful payment:', error);
        
        // Don't clean up data if there was an error - might need it for retry
        // cleanupApolloUrl(session.id);
    }
}

async function triggerApolloScraper(orderDetails) {
    const {
        url,
        totalRecords,
        fileName,
        email,
        cleanOutput,
        paymentSessionId,
        paidAmount
    } = orderDetails;

    try {
        // Prepare the payload for YOUR Apollo actor (matching your actor's expected parameters)
        const payload = {
            url: url,                    // Apollo search URL
            totalRecords: totalRecords,  // Number of leads to scrape
            fileName: fileName,          // File name for the export
            email: email,                // Customer email (MISSING PARAMETER!)
            cleanOutput: cleanOutput     // Whether to clean the output data
        };

        console.log('Triggering YOUR Apollo actor with payload:', {
            ...payload,
            url: payload.url.substring(0, 100) + '...', // Truncate URL for logging
            totalRecords: payload.totalRecords,
            fileName: payload.fileName,
            cleanOutput: payload.cleanOutput
        });

        // Call YOUR Apollo actor
        const actorUrl = `https://api.apify.com/v2/acts/${encodeURIComponent(process.env.APOLLO_ACTOR_ID)}/runs?token=${process.env.APIFY_TOKEN}`;
        
        console.log(`Calling actor: ${process.env.APOLLO_ACTOR_ID}`);
        console.log(`API URL: ${actorUrl}`);
        
        const response = await fetch(actorUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Accept': 'application/json',
                'User-Agent': 'Apollo-Scraper-Webhook/1.0'
            },
            body: JSON.stringify(payload)
        });

        console.log(`Apify API response status: ${response.status}`);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Apify API error response: ${errorText}`);
            throw new Error(`Apollo actor API call failed: ${response.status} ${response.statusText} - ${errorText}`);
        }

        const result = await response.json();
        console.log('Apify API success response:', result);
        
        const runId = result.data?.id || result.id || result.runId;

        console.log(`✅ YOUR Apollo actor started successfully!`);
        console.log(`Payment: ${paymentSessionId}, Run ID: ${runId}`);
        console.log(`Customer: ${email}, Amount: $${paidAmount}`);

        return runId;

    } catch (error) {
        console.error('❌ Error triggering YOUR Apollo scraper:', error);
        console.error('Error details:', {
            message: error.message,
            stack: error.stack,
            actorId: process.env.APOLLO_ACTOR_ID,
            hasApifyToken: !!process.env.APIFY_TOKEN
        });
        throw error;
    }
}

function generateRandomFileName() {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 6; i++) {
        result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return result;
}

async function sendEmailWebhook(email, leadCount, apolloUrl, fileName) {
    try {
        const emailWebhookUrl = process.env.EMAIL_WEBHOOK_URL;
        
        console.log(`📧 EMAIL_WEBHOOK_URL configured: ${emailWebhookUrl ? 'YES' : 'NO'}`);
        console.log(`📧 EMAIL_WEBHOOK_URL value: ${emailWebhookUrl}`);
        
        if (!emailWebhookUrl) {
            console.log('ℹ️ No EMAIL_WEBHOOK_URL configured, skipping email webhook');
            return;
        }

        console.log('📧 Sending email webhook notification...');
        console.log(`📧 Target URL: ${emailWebhookUrl}`);
        console.log(`📧 Customer email: ${email}`);
        console.log(`📧 Lead count: ${leadCount}`);
        console.log(`📧 File name: ${fileName}`);
        
        const emailPayload = {
            email: email,
            leadCount: leadCount,
            apolloUrl: apolloUrl,
            timestamp: new Date().toISOString(),
            service: 'apollo-scraper',
            fileName: fileName,
            source: 'stripe-payment' // Additional context that this came from payment
        };

        console.log('📧 Email webhook payload:', JSON.stringify(emailPayload, null, 2));

        const response = await fetch(emailWebhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Apollo-Scraper-Email/1.0'
            },
            body: JSON.stringify(emailPayload)
        });

        console.log(`📧 Email webhook response status: ${response.status}`);
        console.log(`📧 Email webhook response headers:`, Object.fromEntries(response.headers.entries()));

        if (response.ok) {
            console.log('✅ Email webhook sent successfully');
            const responseText = await response.text();
            console.log('📧 Email webhook response body:', responseText);
        } else {
            console.log(`⚠️ Email webhook failed: ${response.status} ${response.statusText}`);
            const errorText = await response.text();
            console.log('❌ Email webhook error response:', errorText);
        }
    } catch (error) {
        console.error('❌ Email webhook error:', error);
        console.error('❌ Email webhook error stack:', error.stack);
        console.error('❌ Email webhook error details:', {
            name: error.name,
            message: error.message,
            emailWebhookUrl: process.env.EMAIL_WEBHOOK_URL
        });
    }
}

// Raw body parser for Stripe webhooks
export const config = {
    api: {
        bodyParser: false, // Disable body parsing to get raw body for signature verification
    },
} 