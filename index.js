require("dotenv").config();
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const { MongoClient, ServerApiVersion } = require("mongodb");

const app = express();

/* ======================
   MIDDLEWARE
====================== */
app.use(cors());
app.use(express.json());

/* ======================
   BASIC ROUTE
====================== */
app.get("/", (req, res) => {
  res.send("ScholarStream Server Running 🚀");
});

/* ======================
   MONGODB CONNECTION
====================== */
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.gab2mh0.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

/* ======================
   JWT MIDDLEWARES
====================== */
const verifyJWT = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).send({ message: "Unauthorized access" });
  }

  const token = authHeader.split(" ")[1];

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).send({ message: "Forbidden access" });
    }
    req.decoded = decoded;
    next();
  });
};


/* ======================
   DATABASE & ROUTES
====================== */
let usersCollection;
let scholarshipsCollection;

async function run() {
  try {
    await client.connect();

    const db = client.db("scholarstreamdb");
   
    scholarshipsCollection = db.collection("scholarships");

  

    /* ========= SCHOLARSHIPS ========= */

    // Get scholarships (search, filter, sort, pagination)
    app.get("/scholarships", async (req, res) => {
      try {
        const {
          search = "",
          category = "",
          sort = "",
          page = 1,
          limit = 6,
        } = req.query;

        const query = {};

        if (search) {
          query.$or = [
            { scholarshipName: { $regex: search, $options: "i" } },
            { universityName: { $regex: search, $options: "i" } },
            { degree: { $regex: search, $options: "i" } },
          ];
        }

        if (category) {
          query.scholarshipCategory = category;
        }

        let sortQuery = {};
        if (sort === "fee_asc") sortQuery.applicationFees = 1;
        if (sort === "fee_desc") sortQuery.applicationFees = -1;
        if (sort === "date_desc") sortQuery.scholarshipPostDate = -1;

        const scholarships = await scholarshipsCollection
          .find(query)
          .sort(sortQuery)
          .skip((page - 1) * limit)
          .limit(parseInt(limit))
          .toArray();

        const total = await scholarshipsCollection.countDocuments(query);

        res.send({ scholarships, total });
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch scholarships" });
      }
    });

    // Add scholarship
    app.post("/scholarships", async (req, res) => {
      try {
        const scholarship = req.body;
        const result = await scholarshipsCollection.insertOne(scholarship);
        res.send({ success: true, insertedId: result.insertedId });
      } catch (error) {
        res.status(500).send({ message: error.message });
      }
    });

    console.log("✅ MongoDB Connected Successfully");
  } finally {
    // client.close(); 
  }
}

run().catch(console.error);

/* ======================
   SERVER START
====================== */
const port = process.env.PORT || 5000;
app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});
