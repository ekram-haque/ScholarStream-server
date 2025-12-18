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

const verifyAdmin = async (req, res, next) => {
  const email = req.decoded.email;
  const user = await usersCollection.findOne({ email });

  if (user?.role !== "Admin") {
    return res.status(403).send({ message: "Admin only access" });
  }
  next();
};

const verifyModerator = async (req, res, next) => {
  const email = req.decoded.email;
  const user = await usersCollection.findOne({ email });

  if (user?.role !== "Moderator") {
    return res.status(403).send({ message: "Moderator only access" });
  }
  next();
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
    usersCollection = db.collection("users");
    scholarshipsCollection = db.collection("scholarships");

    /* ========= USERS ========= */

    // Create user
    app.post("/users", async (req, res) => {
      try {
        const user = req.body;

        const existingUser = await usersCollection.findOne({
          email: user.email,
        });

        if (existingUser) {
          return res.send({ message: "User already exists" });
        }

        const newUser = {
          ...user,
          role: "student",
          createdAt: new Date(),
        };

        const result = await usersCollection.insertOne(newUser);
        res.send({ success: true, insertedId: result.insertedId });
      } catch (error) {
        res.status(500).send({ message: error.message });
      }
    });

    // Get user role
    app.get("/users/role", async (req, res) => {
      try {
        const email = req.query.email;
        const user = await usersCollection.findOne({ email });
        res.send({ role: user?.role || "Student" });
      } catch (error) {
        res.status(500).send({ message: error.message });
      }
    });

    // Admin: Get all users
    app.get("/dashboard/users", verifyJWT, verifyAdmin, async (req, res) => {
      const users = await usersCollection.find().toArray();
      res.send(users);
    });

    /* ========= JWT ========= */

    app.post("/jwt", (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.JWT_SECRET, {
        expiresIn: "1h",
      });
      res.send({ token });
    });

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

    app.get("/scholarships/:id", async (req, res) => {
  try {
    const id = req.params.id;

    const scholarship = await scholarshipsCollection.findOne({
      _id: new ObjectId(id),
    });

    if (!scholarship) {
      return res.status(404).send({ message: "Scholarship not found" });
    }

    res.send(scholarship);
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
