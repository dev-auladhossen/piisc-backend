const router = require("express").Router();
const c = require("../controllers/noticeController");
const { protect, authorize } = require("../middleware/auth");

const adminOnly = [protect, authorize("admin")];

// PUBLIC: These reads keep the same visibility and response behavior.
router.get("/", c.getAll);
// Register this before /:id so the word "manage" is not treated as an ID.
router.get("/manage", ...adminOnly, c.listManage);
router.get("/:id", c.getOne);

// ADMIN ONLY: Changes to notices require an authenticated admin account.
router.post("/", ...adminOnly, c.create);
router.patch("/:id", ...adminOnly, c.update);
router.delete("/:id", ...adminOnly, c.remove);

module.exports = router;
