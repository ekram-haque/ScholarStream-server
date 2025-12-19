require("dotenv").config();
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

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
  console.log("Token received:", token); // check
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      console.log("JWT Error:", err);
      return res.status(403).send({ message: "Forbidden access" });
    }
    console.log("Decoded JWT:", decoded); // check
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
let  applicationsCollection
let reviewsCollection;

async function run() {
  try {
    await client.connect();

    const db = client.db("scholarstreamdb");
    usersCollection = db.collection("users");
    scholarshipsCollection = db.collection("scholarships");
    reviewsCollection = db.collection("reviews");
    applicationsCollection = db.collection("applications");

    //application related apis-------------------

    // Get applications by user email (Student)
    app.get("/applications", verifyJWT, async (req, res) => {
      const email = req.query.email;

      // security check
      if (req.decoded.email !== email) {
        return res.status(403).send({ message: "Forbidden" });
      }

      const result = await applicationsCollection
        .find({ userEmail: email })
        .sort({ applicationDate: -1 })
        .toArray();

      res.send(result);
    });

    // add application to db

app.post("/applications", verifyJWT, async (req, res) => {
  const application = req.body;

  // prevent duplicate using token email
  const existing = await applicationsCollection.findOne({
    scholarshipId: application.scholarshipId,
    userEmail: req.decoded.email,
  });

  if (existing) {
    return res.status(400).send({ message: "Already applied" });
  }

  const newApplication = {
    ...application,
    userEmail: req.decoded.email,   
    applicationStatus: "pending",
    paymentStatus: "unpaid",
    applicationDate: new Date(),
    feedback: "",
  };

  const result = await applicationsCollection.insertOne(newApplication);
  res.send({ insertedId: result.insertedId });
});

//update application status
app.patch("/applications/:id/status", verifyJWT, verifyModerator, async (req, res) => {
  const id = req.params.id;
  const { status, feedback } = req.body;

  const result = await applicationsCollection.updateOne(
    { _id: new ObjectId(id) },
    {
      $set: {
        applicationStatus: status, // approved / rejected
        feedback: feedback || "",
      },
    }
  );

  res.send(result);
});


    // Delete application (student only & pending)
app.delete("/applications/:id", verifyJWT, async (req, res) => {
  const id = req.params.id;
  const email = req.decoded.email;

  const application = await applicationsCollection.findOne({
    _id: new ObjectId(id),
  });

  if (!application) {
    return res.status(404).send({ message: "Not found" });
  }

  if (application.userEmail !== email) {
    return res.status(403).send({ message: "Forbidden" });
  }

  if (application.applicationStatus !== "pending") {
    return res
      .status(400)
      .send({ message: "Cannot delete completed application" });
  }

  const result = await applicationsCollection.deleteOne({
    _id: new ObjectId(id),
  });

  res.send(result);
});

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

    //get one user
    app.get("/users/:email", async (req, res) => {
      const email = req.params.email;
      const user = await usersCollection.findOne({ email });
      res.send(user);
    });

    // Admin: Get all users
    app.get("/dashboard/users", verifyJWT, verifyAdmin, async (req, res) => {
      const users = await usersCollection.find().toArray();
      res.send(users);
    });

    // Change role
    app.patch(
      "/dashboard/users/:id/role",
      verifyJWT,
      verifyAdmin,
      async (req, res) => {
        try {
          const id = req.params.id;
          const { role } = req.body;

          const updated = await usersCollection.findOneAndUpdate(
            { _id: new ObjectId(id) },
            { $set: { role } },
            { returnDocument: "after" }
          );
          res.send(updated.value);
        } catch (error) {
          res.status(500).send({ message: error.message });
        }
      }
    );

    // Delete user
    app.delete(
      "/dashboard/users/:id",
      verifyJWT,
      verifyAdmin,
      async (req, res) => {
        try {
          const id = req.params.id;
          await usersCollection.deleteOne({ _id: new ObjectId(id) });
          res.send({ success: true, message: "User deleted" });
        } catch (error) {
          res.status(500).send({ message: error.message });
        }
      }
    );

    app.get(
      "/dashboard/analytics",
      verifyJWT,
      verifyAdmin,
      async (req, res) => {
        try {
          const totalUsers = await usersCollection.countDocuments();
          const totalScholarships =
            await scholarshipsCollection.countDocuments();

          const totalFeesAgg = await scholarshipsCollection
            .aggregate([
              {
                $group: { _id: null, totalFees: { $sum: "$applicationFees" } },
              },
            ])
            .toArray();

          const totalFeesCollected = totalFeesAgg[0]?.totalFees || 0;

          res.send({ totalUsers, totalScholarships, totalFeesCollected });
        } catch (error) {
          res.status(500).send({ message: error.message });
        }
      }
    );

    /* ========= JWT ========= */

  app.post("/jwt", (req, res) => {
  const { email } = req.body;  
  const token = jwt.sign({ email }, process.env.JWT_SECRET, { expiresIn: "1h" });
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
    // Update scholarship
    app.patch("/scholarships/:id", verifyJWT, verifyAdmin, async (req, res) => {
      try {
        const id = req.params.id;
        const updated = await scholarshipsCollection.findOneAndUpdate(
          { _id: new ObjectId(id) },
          { $set: req.body },
          { returnDocument: "after" }
        );
        res.send(updated.value);
      } catch (error) {
        res.status(500).send({ message: error.message });
      }
    });

    // Delete scholarship
    app.delete(
      "/scholarships/:id",
      verifyJWT,
      verifyAdmin,
      async (req, res) => {
        try {
          const id = req.params.id;
          await scholarshipsCollection.deleteOne({ _id: new ObjectId(id) });
          res.send({ success: true, message: "Scholarship deleted" });
        } catch (error) {
          res.status(500).send({ message: error.message });
        }
      }
    );

    //get one scholarship
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
