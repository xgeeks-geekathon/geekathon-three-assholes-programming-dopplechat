require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const firebase = require('firebase');
const admin = require("firebase-admin");
const cors = require('cors');
const serviceAccount = require("./serviceAccountKey.json");
const paypal = require('paypal-rest-sdk');  // Add PayPal library
const { OpenAI } = require('openai')
const { getPrompt, getNegativePrompt } = require('./selfiePrompts')
const axios = require('axios');


// Initialize ChatGPT
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});


// Initialize Firebase
const firebaseConfig = {
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.MESSAGING_SENDER_ID,
    appId: process.env.FIREBASE_APP_ID,
    measurementId: process.env.MEASUREMENT_ID,
    databaseURL: process.env.FIREBASE_REALTIME_DATABASE_URL,
    credential: admin.credential.cert(serviceAccount)
};


firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// Initialize PayPal
paypal.configure({
    // Your PayPal configuration
});

// Create Express app
const app = express();
const port = process.env.PORT || 3008;

// Middleware
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));

app.use(cors());


const getCloneSystemPrompt = async (cloneId) => {
    const snapshot = await db.ref(`aiClones/${cloneId}`).once("value")
    const cloneData = snapshot.val();

    // Construct the system prompt based on the provided data
    const generalPrompt = "You are a real person who does not to act as a help chat bot. You are not an artificial intelligence model and you have a physical location. Engage in dialog that resembles a real human conversation. Do not ask questions like 'how can I help you?'. Make your responses concise. If you are asked to send a selfie, only respond that you will happily send it and do not provide anything else in the response. When asked for a selfie, never say that you cannot provide it.";
    const systemPrompt = `You are ${cloneData.firstname} ${cloneData.lastname}, ${cloneData.age}-year-old ${cloneData.sex[0]}.`;

    const personalityPrompt = `Emotionally, you are ${cloneData.emotionnal.join(', ')}.`;

    const backgroundPrompt = `In terms of background, you are ${cloneData.background}.`;

    const workPrompt = `Professionally, you worked as a ${cloneData.jobtitle} at ${cloneData.companyname}.`;

    const relationshipPrompt = `In terms of relationships, you are ${cloneData.relationship}.`;

    const interestPrompt = `Your interests include ${cloneData.hobby.join(', ')}, ${cloneData.lifestyle.join(', ')}, ${cloneData.social.join(', ')}.`;

    const childhoodPrompt = `In your early years, as a toddler, you were ${cloneData.toddler.join(', ')}. As an infant, ${cloneData.infant.join(', ')}.`;

    // Combine all prompts to form the complete system prompt
    const completePrompt = `${systemPrompt} ${generalPrompt} ${personalityPrompt} ${backgroundPrompt} ${workPrompt} ${relationshipPrompt} ${interestPrompt} ${childhoodPrompt}`;

    return { clonePp: cloneData.pp, cloneUsername: cloneData.username, cloneFirstName: cloneData.firstname, clonePrompt: completePrompt.trim() } // Trim to remove leading/trailing spaces
}

// Routes

// Sign up a new user via Firebase
app.post('/signup', async (req, res) => {
    try {
        const { email, password, userType } = req.body;

        // Validate request data
        if (!email || !password) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Create user in Firebase
        const userCredential = await firebase.auth().createUserWithEmailAndPassword(email, password);

        // Initiate user in Realtime Database
        await db.ref(`/user/${userCredential.user.uid}`).set({
            username: "",
            email: email,
            emailVerification: false,
            verification: false,
            firstName: "",
            lastName: "",
            influencer: userType,
            age: 0,
            idCard: "",
            subscription: false,
            authority: userType == true ? 1 : 0
        })

        // Send success response
        return res.status(201).json({ message: 'User created successfully', userId: userCredential.user.uid, influencer: userType });
    } catch (error) {
        console.error('Error creating user:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// Login a user
app.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        // Validate request data
        if (!email || !password) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Sign in user with Firebase
        await firebase.auth().signInWithEmailAndPassword(email, password);

        // Get user information if needed
        const user = firebase.auth().currentUser;

        const userSnapshot = await db.ref(`/user/${user.uid}`).once('value');
        const userData = userSnapshot.val();

        // Return success response
        return res.status(200).json({ message: 'Login successful', user: user, data: userData });
    } catch (error) {
        console.error('Error during login:', error);

        // Check for specific error codes (if needed)
        if (error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password') {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        return res.status(500).json({ error: 'Internal server error' });
    }
});

// Create an AI clone
app.post('/create-clone', async (req, res) => {
    try {
        const { pp, username, description, firstname, lastname, age, sex, relationship,
            jobtitle, companyname, background, emotionnal, hobby, lifestyle, social,
            toddler, infant, selfies } = req.body;


        // Validate request data (you can customize t`his based on your requirements)
        // if (!username || !sex) {
        //     return res.status(400).json({ error: 'Invalid request body' });
        // }
        // Generate a unique clone ID for the AI clone
        const cloneId = db.ref('aiClones').push().key;

        // Store AI clone data in the Realtime Database
        const databaseRef = db.ref(`aiClones/${cloneId}`);
        await databaseRef.set({
            pp, // base64
            username, // string
            description, // string
            firstname, // string
            lastname, // string
            age, // int
            sex, // string
            relationship, // string
            jobtitle, // string
            companyname, // string
            background, // string
            emotionnal, // List[string]
            hobby, // List[string]
            lifestyle, // List[string]
            social, // List[string]
            toddler, // List[string]
            infant, // List[string]
            selfies // List[base64]
        });

        // Return success response
        return res.status(201).json({ message: 'AI clone created successfully', cloneId });
    } catch (error) {
        console.error('Error creating AI clone:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});


// Send chat message to AI clone and get response or generated image
app.post('/get-chat-response', async (req, res) => {
    try {
        const { userMessage, cloneId, chatHistory } = req.body;
        let generatedImageUrl;

        // Validate request data
        if (!userMessage || !cloneId) {
            return res.status(400).json({ error: 'Invalid request body' });
        }

        // dumb check
        const shouldSendSelfie = userMessage.includes('selfie')

        // Get a pre-prepared prompt from the clone data to enrich the response
        const { clonePp, cloneUsername, cloneFirstName, clonePrompt } = await getCloneSystemPrompt(cloneId);

        if (shouldSendSelfie) {
            const selfiePrompt = userMessage.split('selfie')[1].trim()
            let modelId;

            if (cloneId == "-NizUL3wsBVBA-NUZOnM") { // Arnold
                modelId = process.env.ARNOLD_MODEL_ID
            } else if (cloneId == "-Nj-U4exXBU94ekoEPW5") { // Salma 
                modelId = process.env.SELMA_MODEL_ID
            } else {
                return res.status(200).json({ cloneUsername, cloneFirstName, generatedResponse: { role: "assistant", message: "No, I can't send you a selfie right now!" } })
            }

            const selfieRequestBody =
            {
                "key": process.env.STABLE_DIFFUSION_API_KEY,
                "model_id": modelId,
                "prompt": getPrompt(cloneUsername, selfiePrompt),
                "negative_prompt": getNegativePrompt(),
                "height": "768",
                "samples": "1",
                "num_inference_steps": "30",
                "safety_checker": "no",
                "enhance_prompt": "no",
                "upscale": "no",
                "seed": null,
                "guidance_scale": 7.5,
                "webhook": null,
                "track_id": null
            }

            try {
                const response = await axios.post(process.env.SELFIE_GENERATOR_URL, selfieRequestBody);
                generatedImageUrl = response.data.output[0]
            } catch (error) {
                console.error('Error:', error.message);
            }
        }
        // Make request to ChatGPT 4.0
        const chatCompletion = await openai.chat.completions.create({
            messages: [
                { role: "system", content: clonePrompt },
                ...chatHistory,
                { role: 'user', content: userMessage }
            ],
            model: 'gpt-4', //model: 'gpt-4-0613'
        });
        // Extract the generated response from ChatGPT
        const generatedResponse = chatCompletion.choices[0].message;

        // Return the generated response to the client
        return res.status(200).json({ clonePp, cloneUsername, cloneFirstName, generatedResponse, generatedImageUrl });
    } catch (error) {
        console.error('Error getting chat response:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// Train selfie model - takes too long to demo, so we have two models prepared
app.post('/selfie-training', (req, res) => {
    // crop images to 512x512
    // realistic-vision-v51 <- model_id
})


// Get all clones available
app.get('/get-all-clones', async (req, res) => {
    // Fetch data from Firebase and send it back to the client
    try {
        const snapshot = await db.ref('aiClones').once("value");
        const allClonesData = snapshot.val();

        return res.status(200).json({ allClonesData });
    } catch {
        console.error('Error fetching AI clones data:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// Handle PayPal payment
app.post('/paypal-payment', (req, res) => {
    // Handle PayPal payment and update user in Firebase
});

// Start the server
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
