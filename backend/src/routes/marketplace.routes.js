/**
 * Marketplace Routes
 * 
 * API endpoints for marketplace functionality
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const marketplaceController = require('../controllers/marketplace.controller');

// All routes require authentication
router.use(authenticate);

/**
 * @route   POST /api/v1/marketplace/products
 * @desc    Create a new product listing
 * @access  Private
 */
router.post('/products', marketplaceController.createProduct);

/**
 * @route   GET /api/v1/marketplace/schools/:schoolId/products
 * @desc    Get products for a school
 * @access  Private
 */
router.get('/schools/:schoolId/products', marketplaceController.getSchoolProducts);

/**
 * @route   GET /api/v1/marketplace/sellers/:sellerId/products
 * @desc    Get products for a seller
 * @access  Private (seller or admin only)
 */
router.get('/sellers/:sellerId/products', marketplaceController.getSellerProducts);

/**
 * @route   GET /api/v1/marketplace/products/:id
 * @desc    Get a specific product
 * @access  Private
 */
router.get('/products/:id', marketplaceController.getProduct);

/**
 * @route   PUT /api/v1/marketplace/products/:id
 * @desc    Update a product
 * @access  Private (seller or admin only)
 */
router.put('/products/:id', marketplaceController.updateProduct);

/**
 * @route   DELETE /api/v1/marketplace/products/:id
 * @desc    Delete a product
 * @access  Private (seller or admin only)
 */
router.delete('/products/:id', marketplaceController.deleteProduct);

/**
 * @route   POST /api/v1/marketplace/orders
 * @desc    Create an order
 * @access  Private
 */
router.post('/orders', marketplaceController.createOrder);

/**
 * @route   GET /api/v1/marketplace/buyers/:buyerId/orders
 * @desc    Get orders for a buyer
 * @access  Private (buyer or admin only)
 */
router.get('/buyers/:buyerId/orders', marketplaceController.getBuyerOrders);

/**
 * @route   GET /api/v1/marketplace/sellers/:sellerId/orders
 * @desc    Get orders for a seller
 * @access  Private (seller or admin only)
 */
router.get('/sellers/:sellerId/orders', marketplaceController.getSellerOrders);

/**
 * @route   PUT /api/v1/marketplace/orders/:id/status
 * @desc    Update order status
 * @access  Private (buyer, seller, or admin)
 */
router.put('/orders/:id/status', marketplaceController.updateOrderStatus);

/**
 * @route   POST /api/v1/marketplace/reviews
 * @desc    Create a product review
 * @access  Private
 */
router.post('/reviews', marketplaceController.createReview);

/**
 * @route   GET /api/v1/marketplace/products/:productId/reviews
 * @desc    Get reviews for a product
 * @access  Private
 */
router.get('/products/:productId/reviews', marketplaceController.getProductReviews);

/**
 * @route   GET /api/v1/marketplace/sellers/:sellerId/reviews
 * @desc    Get reviews for a seller
 * @access  Private
 */
router.get('/sellers/:sellerId/reviews', marketplaceController.getSellerReviews);

module.exports = router;
