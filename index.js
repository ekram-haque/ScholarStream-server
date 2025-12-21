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
  res.status(200).json({
    success: true,
    message: "ScholarStream Server is running ",
    version: "1.0.0",
  });
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

  if (user?.role !== "admin") {
    return res.status(403).send({ message: "Admin only access" });
  }
  next();
};

const verifyModerator = async (req, res, next) => {
  const email = req.decoded.email;
  const user = await usersCollection.findOne({ email });

  if (user?.role !== "moderator") {
    return res.status(403).send({ message: "Moderator only access" });
  }
  next();
};

/* ======================
   DATABASE & ROUTES
====================== */
let usersCollection;
let scholarshipsCollection;
let applicationsCollection;
let reviewsCollection;

async function run() {
  try {
    await client.connect();

    const db = client.db("scholarstreamdb");
    usersCollection = db.collection("users");
    scholarshipsCollection = db.collection("scholarships");
    reviewsCollection = db.collection("reviews");
    applicationsCollection = db.collection("applications");

    // Get all reviews by a student
    app.get("/reviews", verifyJWT, async (req, res) => {
      const email = req.query.email;

      // security check
      if (req.decoded.email !== email) {
        return res.status(403).send({ message: "Forbidden" });
      }

      try {
        const result = await reviewsCollection
          .find({ userEmail: email })
          .sort({ createdAt: -1 })
          .toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: error.message });
      }
    });

    // Add a review
    app.post("/reviews", verifyJWT, async (req, res) => {
      const { applicationId, rating, comment } = req.body;

      try {
        // Find the application first
        const application = await applicationsCollection.findOne({
          _id: new ObjectId(applicationId),
        });
        if (!application)
          return res.status(404).send({ message: "Application not found" });

        // Only allow review if application is approved
        if (application.applicationStatus !== "approved") {
          return res
            .status(403)
            .send({ message: "Cannot review before approval" });
        }

        const newReview = {
          scholarshipId: application._id,
          scholarshipName:
            application.scholarshipName || application.subjectCategory,
          universityName: application.universityName,
          userName: req.decoded.name || req.decoded.email,
          userEmail: req.decoded.email,
          ratingPoint: rating,
          reviewComment: comment,
          reviewDate: new Date(),
        };

        const result = await reviewsCollection.insertOne(newReview);
        res.send({ insertedId: result.insertedId });
      } catch (error) {
        res.status(500).send({ message: error.message });
      }
    });

    // Update a review
    app.patch("/reviews/:id", verifyJWT, async (req, res) => {
      const id = req.params.id;
      const { rating, comment } = req.body;

      try {
        const updated = await reviewsCollection.findOneAndUpdate(
          { _id: new ObjectId(id), userEmail: req.decoded.email }, // security: only own review
          { $set: { rating, comment } },
          { returnDocument: "after" }
        );

        if (!updated.value) {
          return res
            .status(404)
            .send({ message: "Review not found or forbidden" });
        }

        res.send(updated.value);
      } catch (error) {
        res.status(500).send({ message: error.message });
      }
    });

    // Delete a review
    app.delete("/reviews/:id", verifyJWT, async (req, res) => {
      const id = req.params.id;

      try {
        const result = await reviewsCollection.deleteOne({
          _id: new ObjectId(id),
          userEmail: req.decoded.email, // only delete own review
        });

        if (result.deletedCount === 0) {
          return res
            .status(404)
            .send({ message: "Review not found or forbidden" });
        }

        res.send(result);
      } catch (error) {
        res.status(500).send({ message: error.message });
      }
    });

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
    app.patch(
      "/applications/:id/status",
      verifyJWT,
      verifyModerator,
      async (req, res) => {
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
      }
    );

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

    app.get("/applications/:id", async (req, res) => {
  const id = req.params.id;
  const application = await applicationsCollection.findOne({
    _id: new ObjectId(id)
  });

  res.send(application);
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

    // Middleware: verifyJWT, verifyAdmin
    app.get("/admin/scholarships", verifyJWT, verifyAdmin, async (req, res) => {
      try {
        const { search = "", category = "", sort = "" } = req.query;

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

        // Admin-এ limit/remove pagination
        const scholarships = await scholarshipsCollection
          .find(query)
          .sort(sortQuery)
          .toArray();

        const total = scholarships.length;

        res.send({ scholarships, total });
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch scholarships" });
      }
    });

    // Get all users
    app.get("/dashboard/users", verifyJWT, verifyAdmin, async (req, res) => {
      try {
        const users = await usersCollection.find({}).toArray();
        res.send(users);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Failed to fetch users" });
      }
    });

    // Change role
    app.patch(
      "/dashboard/users/:id/role",
      verifyJWT,
      verifyAdmin,
      async (req, res) => {
        try {
          const userId = req.params.id;
          const { role } = req.body;

          if (!["student", "moderator", "admin"].includes(role.toLowerCase())) {
            return res.status(400).send({ message: "Invalid role" });
          }

          const result = await usersCollection.findOneAndUpdate(
            { _id: new ObjectId(userId) },
            { $set: { role: role.toLowerCase() } },
            { returnDocument: "after" } // return updated document
          );

          if (!result.value)
            return res.status(404).send({ message: "User not found" });

          res.send(result.value);
        } catch (error) {
          console.error(error);
          res.status(500).send({ message: "Failed to update user role" });
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

    // Analytics route
    app.get(
      "/dashboard/analytics",
      verifyJWT,
      verifyAdmin,
      async (req, res) => {
        try {
          const totalUsers = await usersCollection.countDocuments();
          const totalScholarships =
            await scholarshipsCollection.countDocuments();

          // Only PAID applications
          const applications = await applicationsCollection
            .find({ paymentStatus: "paid" })
            .toArray();

          // ✅ Total fees collected
          const totalFeesCollected = applications.reduce(
            (sum, app) =>
              sum + (app.applicationFees || 0) + (app.serviceCharge || 0),
            0
          );

          // ✅ Applications per university
          const applicationsPerUniversity = {};
          applications.forEach((app) => {
            const uni = app.universityName || "Unknown";
            applicationsPerUniversity[uni] =
              (applicationsPerUniversity[uni] || 0) + 1;
          });

          // ✅ Applications per subject category
          const applicationsPerCategory = {};
          applications.forEach((app) => {
            const cat = app.subjectCategory || "Other";
            applicationsPerCategory[cat] =
              (applicationsPerCategory[cat] || 0) + 1;
          });

          res.send({
            totalUsers,
            totalScholarships,
            totalFeesCollected,
            applicationsPerUniversity,
            applicationsPerCategory,
          });
        } catch (error) {
          console.error(error);
          res.status(500).send({ message: "Failed to fetch analytics" });
        }
      }
    );

    // ======================
    // Moderator: Get all applications
    // ======================
    app.get(
      "/moderator/applications",
      verifyJWT,
      verifyModerator,
      async (req, res) => {
        try {
          const applications = await applicationsCollection
            .find()
            .sort({ applicationDate: -1 })
            .toArray();
          res.send(applications);
        } catch (error) {
          res.status(500).send({ message: "Failed to fetch applications" });
        }
      }
    );

    // Moderator: Update application status
    app.patch(
      "/moderator/applications/:id",
      verifyJWT,
      verifyModerator,
      async (req, res) => {
        try {
          const id = req.params.id;
          const { status, feedback } = req.body;

          const result = await applicationsCollection.updateOne(
            { _id: new ObjectId(id) },
            {
              $set: {
                applicationStatus: status,
                feedback: feedback || "",
              },
            }
          );

          res.send(result);
        } catch (error) {
          res.status(500).send({ message: "Failed to update application" });
        }
      }
    );

    // Get all reviews (for moderator)
    app.get(
      "/moderator/reviews",
      verifyJWT,
      verifyModerator,
      async (req, res) => {
        try {
          const allReviews = await reviewsCollection
            .find({})
            .sort({ createdAt: -1 })
            .toArray();
          res.send(allReviews);
        } catch (error) {
          res.status(500).send({ message: error.message });
        }
      }
    );

    app.delete(
      "/moderator/reviews/:id",
      verifyJWT,
      verifyModerator,
      async (req, res) => {
        try {
          const id = req.params.id;
          const result = await reviewsCollection.deleteOne({
            _id: new ObjectId(id),
          });
          if (result.deletedCount > 0) {
            res.send({ success: true, message: "Review deleted successfully" });
          } else {
            res.status(404).send({ message: "Review not found" });
          }
        } catch (error) {
          res.status(500).send({ message: error.message });
        }
      }
    );

    /* ========= JWT ========= */

    app.post("/jwt", (req, res) => {
      const { email } = req.body;
      const token = jwt.sign({ email }, process.env.JWT_SECRET, {
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
    // Update scholarship
    app.patch("/scholarships/:id", verifyJWT, verifyAdmin, async (req, res) => {
      try {
        const id = req.params.id;

        // sanitize & convert types
        const updateData = {
          ...req.body,
        };

        if (updateData.applicationFees !== undefined) {
          updateData.applicationFees = parseFloat(updateData.applicationFees);
        }

        if (updateData.applicationDeadline) {
          const date = new Date(updateData.applicationDeadline);
          if (isNaN(date.getTime())) {
            return res
              .status(400)
              .send({ message: "Invalid applicationDeadline" });
          }
          updateData.applicationDeadline = date;
        }

        const updated = await scholarshipsCollection.findOneAndUpdate(
          { _id: new ObjectId(id) },
          { $set: updateData },
          { returnDocument: "after" }
        );

        if (!updated.value) {
          return res.status(404).send({ message: "Scholarship not found" });
        }

        res.send(updated.value);
      } catch (error) {
        console.error(error);
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

    // console.log("✅ MongoDB Connected Successfully");
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
  // console.log(`🚀 Server running on port ${port}`);
});
