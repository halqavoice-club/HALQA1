/**
 * Marketplace Controller
 * 
 * Handles marketplace functionality including:
 * - Product listings
 * - Order management
 * - Product reviews
 */

const prisma = require('../utils/prisma');
const logger = require('../utils/logger');

/**
 * Create a new product listing
 */
async function createProduct(req, res) {
  try {
    const { schoolId, sellerId, title, description, category, condition, price, negotiable, images, stock, expiresAt } = req.body;
    const userId = req.user.id;

    const product = await prisma.product.create({
      data: {
        schoolId,
        sellerId: sellerId || userId,
        title,
        description,
        category,
        condition,
        price,
        negotiable: negotiable || false,
        images: images || [],
        stock: stock || 1,
        viewCount: 0,
        favoriteCount: 0,
        soldCount: 0,
        isActive: true,
        featured: false,
        expiresAt: expiresAt ? new Date(expiresAt) : null
      }
    });

    logger.info(`Product created: ${product.id} by seller ${product.sellerId}`);
    
    res.status(201).json({
      success: true,
      data: product
    });
  } catch (error) {
    logger.error('Failed to create product:', error);
    res.status(500).json({
      success: false,
      error:({
        code: 'INT_001',
        message: 'Failed to create product',
        statusCode: 500
      })
    });
  }
}

/**
 * Get products for a school
 */
async function getSchoolProducts(req, res) {
  try {
    const { schoolId } = req.params;
    const { category, condition, isActive, featured } = req.query;

    const where = { schoolId };
    if (category) where.category = category;
    if (condition) where.condition = condition;
    if (isActive !== undefined) where.isActive = isActive === 'true';
    if (featured !== undefined) where.featured = featured === 'true';

    const products = await prisma.product.findMany({
      where,
      include: {
        seller: {
          select: { id: true, firstName: true, lastName: true, avatarUrl: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json({
      success: true,
      data: products
    });
  } catch (error) {
    logger.error('Failed to get school products:', error);
    res.status(500).json({
      success: false,
      error:({
        code: 'INT_001',
        message: 'Failed to get products',
        statusCode: 500
      })
    });
  }
}

/**
 * Get products for a seller
 */
async function getSellerProducts(req, res) {
  try {
    const { sellerId } = req.params;
    const userId = req.user.id;

    // NF-4 FIX: SUPER_ADMIN only for cross-user product access. Marketplace is a Social feature.
    if (sellerId !== userId && req.user.role !== 'SUPER_ADMIN') {
      return res.status(403).json({
        success: false,
        error:({
          code: 'AUTH_001',
          message: 'Not authorized to view these products',
          statusCode: 403
        })
      });
    }

    const products = await prisma.product.findMany({
      where: { sellerId },
      orderBy: { createdAt: 'desc' }
    });

    res.json({
      success: true,
      data: products
    });
  } catch (error) {
    logger.error('Failed to get seller products:', error);
    res.status(500).json({
      success: false,
      error:({
        code: 'INT_001',
        message: 'Failed to get products',
        statusCode: 500
      })
    });
  }
}

/**
 * Get a specific product
 */
async function getProduct(req, res) {
  try {
    const { id } = req.params;

    const product = await prisma.product.findUnique({
      where: { id },
      include: {
        seller: {
          select: { id: true, firstName: true, lastName: true, avatarUrl: true }
        },
        reviews: {
          include: {
            reviewer: {
              select: { id: true, firstName: true, lastName: true, avatarUrl: true }
            }
          }
        }
      }
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        error:({
          code: 'NOT_FOUND_001',
          message: 'Product not found',
          statusCode: 404
        })
      });
    }

    // Increment view count
    await prisma.product.update({
      where: { id },
      data: { viewCount: { increment: 1 } }
    });

    res.json({
      success: true,
      data: { ...product, viewCount: product.viewCount + 1 }
    });
  } catch (error) {
    logger.error('Failed to get product:', error);
    res.status(500).json({
      success: false,
      error:({
        code: 'INT_001',
        message: 'Failed to get product',
        statusCode: 500
      })
    });
  }
}

/**
 * Update a product
 */
async function updateProduct(req, res) {
  try {
    const { id } = req.params;
    const { title, description, category, condition, price, negotiable, images, stock, isActive, featured, expiresAt } = req.body;
    const userId = req.user.id;

    const product = await prisma.product.findUnique({
      where: { id }
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        error:({
          code: 'NOT_FOUND_001',
          message: 'Product not found',
          statusCode: 404
        })
      });
    }

    // NF-4 FIX: Seller or SUPER_ADMIN only — SCHOOL_ADMIN cannot manage other users' products.
    if (product.sellerId !== userId && req.user.role !== 'SUPER_ADMIN') {
      return res.status(403).json({
        success: false,
        error:({
          code: 'AUTH_001',
          message: 'Not authorized to update this product',
          statusCode: 403
        })
      });
    }

    const updated = await prisma.product.update({
      where: { id },
      data: {
        title: title !== undefined ? title : product.title,
        description: description !== undefined ? description : product.description,
        category: category !== undefined ? category : product.category,
        condition: condition !== undefined ? condition : product.condition,
        price: price !== undefined ? price : product.price,
        negotiable: negotiable !== undefined ? negotiable : product.negotiable,
        images: images !== undefined ? images : product.images,
        stock: stock !== undefined ? stock : product.stock,
        isActive: isActive !== undefined ? isActive : product.isActive,
        featured: featured !== undefined ? featured : product.featured,
        expiresAt: expiresAt !== undefined ? (expiresAt ? new Date(expiresAt) : null) : product.expiresAt
      }
    });

    logger.info(`Product ${id} updated by seller ${userId}`);

    res.json({
      success: true,
      data: updated
    });
  } catch (error) {
    logger.error('Failed to update product:', error);
    res.status(500).json({
      success: false,
      error:({
        code: 'INT_001',
        message: 'Failed to update product',
        statusCode: 500
      })
    });
  }
}

/**
 * Delete a product
 */
async function deleteProduct(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const product = await prisma.product.findUnique({
      where: { id }
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        error:({
          code: 'NOT_FOUND_001',
          message: 'Product not found',
          statusCode: 404
        })
      });
    }

    // NF-4 FIX: Seller or SUPER_ADMIN only — SCHOOL_ADMIN cannot delete other users' products.
    if (product.sellerId !== userId && req.user.role !== 'SUPER_ADMIN') {
      return res.status(403).json({
        success: false,
        error:({
          code: 'AUTH_001',
          message: 'Not authorized to delete this product',
          statusCode: 403
        })
      });
    }

    await prisma.product.update({
      where: { id },
      data: { deletedAt: new Date() }
    });

    logger.info(`Product ${id} deleted by seller ${userId}`);

    res.json({
      success: true,
      message: 'Product deleted successfully'
    });
  } catch (error) {
    logger.error('Failed to delete product:', error);
    res.status(500).json({
      success: false,
      error:({
        code: 'INT_001',
        message: 'Failed to delete product',
        statusCode: 500
      })
    });
  }
}

/**
 * Create an order
 */
async function createOrder(req, res) {
  try {
    const { productId, quantity, shippingAddress, notes } = req.body;
    const userId = req.user.id;

    const product = await prisma.product.findUnique({
      where: { id: productId }
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        error:({
          code: 'NOT_FOUND_001',
          message: 'Product not found',
          statusCode: 404
        })
      });
    }

    // Check if product is available
    if (!product.isActive || product.stock < quantity) {
      return res.status(400).json({
        success: false,
        error:({
          code: 'VAL_001',
          message: 'Product not available or insufficient stock',
          statusCode: 400
        })
      });
    }

    // Check if user is not buying their own product
    if (product.sellerId === userId) {
      return res.status(400).json({
        success: false,
        error:({
          code: 'VAL_001',
          message: 'Cannot buy your own product',
          statusCode: 400
        })
      });
    }

    const totalPrice = product.price * quantity;

    const order = await prisma.order.create({
      data: {
        schoolId: product.schoolId,
        productId,
        buyerId: userId,
        sellerId: product.sellerId,
        quantity,
        totalPrice,
        shippingAddress,
        notes,
        status: 'PENDING'
      }
    });

    // Update product stock
    await prisma.product.update({
      where: { id: productId },
      data: { stock: { decrement: quantity } }
    });

    logger.info(`Order ${order.id} created by buyer ${userId} for product ${productId}`);

    res.status(201).json({
      success: true,
      data: order
    });
  } catch (error) {
    logger.error('Failed to create order:', error);
    res.status(500).json({
      success: false,
      error:({
        code: 'INT_001',
        message: 'Failed to create order',
        statusCode: 500
      })
    });
  }
}

/**
 * Get orders for a buyer
 */
async function getBuyerOrders(req, res) {
  try {
    const { buyerId } = req.params;
    const { status } = req.query;
    const userId = req.user.id;

    // NF-4 FIX: Buyer or SUPER_ADMIN only for cross-user order access.
    if (buyerId !== userId && req.user.role !== 'SUPER_ADMIN') {
      return res.status(403).json({
        success: false,
        error:({
          code: 'AUTH_001',
          message: 'Not authorized to view these orders',
          statusCode: 403
        })
      });
    }

    const where = { buyerId };
    if (status) where.status = status;

    const orders = await prisma.order.findMany({
      where,
      include: {
        product: {
          include: {
            seller: {
              select: { id: true, firstName: true, lastName: true }
            }
          }
        },
        buyer: {
          select: { id: true, firstName: true, lastName: true }
        },
        seller: {
          select: { id: true, firstName: true, lastName: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json({
      success: true,
      data: orders
    });
  } catch (error) {
    logger.error('Failed to get buyer orders:', error);
    res.status(500).json({
      success: false,
      error:({
        code: 'INT_001',
        message: 'Failed to get orders',
        statusCode: 500
      })
    });
  }
}

/**
 * Get orders for a seller
 */
async function getSellerOrders(req, res) {
  try {
    const { sellerId } = req.params;
    const { status } = req.query;
    const userId = req.user.id;

    // NF-4 FIX: Seller or SUPER_ADMIN only for cross-user order access.
    if (sellerId !== userId && req.user.role !== 'SUPER_ADMIN') {
      return res.status(403).json({
        success: false,
        error:({
          code: 'AUTH_001',
          message: 'Not authorized to view these orders',
          statusCode: 403
        })
      });
    }

    const where = { sellerId };
    if (status) where.status = status;

    const orders = await prisma.order.findMany({
      where,
      include: {
        product: true,
        buyer: {
          select: { id: true, firstName: true, lastName: true, avatarUrl: true }
        },
        seller: {
          select: { id: true, firstName: true, lastName: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json({
      success: true,
      data: orders
    });
  } catch (error) {
    logger.error('Failed to get seller orders:', error);
    res.status(500).json({
      success: false,
      error:({
        code: 'INT_001',
        message: 'Failed to get orders',
        statusCode: 500
      })
    });
  }
}

/**
 * Update order status
 */
async function updateOrderStatus(req, res) {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const userId = req.user.id;

    const order = await prisma.order.findUnique({
      where: { id }
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        error:({
          code: 'NOT_FOUND_001',
          message: 'Order not found',
          statusCode: 404
        })
      });
    }

    // NF-4 FIX: Seller, buyer, or SUPER_ADMIN only for order status updates.
    const isAdmin = req.user.role === 'SUPER_ADMIN';
    const isSeller = order.sellerId === userId;
    const isBuyer = order.buyerId === userId;

    if (!isSeller && !isBuyer && !isAdmin) {
      return res.status(403).json({
        success: false,
        error:({
          code: 'AUTH_001',
          message: 'Not authorized to update this order',
          statusCode: 403
        })
      });
    }

    const updateData = { status };
    const now = new Date();

    // Set timestamp based on status
    if (status === 'CONFIRMED') updateData.confirmedAt = now;
    if (status === 'SHIPPED') updateData.shippedAt = now;
    if (status === 'DELIVERED') updateData.deliveredAt = now;
    if (status === 'CANCELLED') updateData.cancelledAt = now;
    if (status === 'REFUNDED') updateData.refundedAt = now;

    const updated = await prisma.order.update({
      where: { id },
      data: updateData
    });

    // Update product sold count if delivered
    if (status === 'DELIVERED') {
      await prisma.product.update({
        where: { id: order.productId },
        data: { soldCount: { increment: order.quantity } }
      });
    }

    // Restore stock if cancelled
    if (status === 'CANCELLED') {
      await prisma.product.update({
        where: { id: order.productId },
        data: { stock: { increment: order.quantity } }
      });
    }

    logger.info(`Order ${id} status updated to ${status} by user ${userId}`);

    res.json({
      success: true,
      data: updated
    });
  } catch (error) {
    logger.error('Failed to update order status:', error);
    res.status(500).json({
      success: false,
      error:({
        code: 'INT_001',
        message: 'Failed to update order status',
        statusCode: 500
      })
    });
  }
}

/**
 * Create a product review
 */
async function createReview(req, res) {
  try {
    const { productId, orderId, rating, title, body, images } = req.body;
    const userId = req.user.id;

    // Verify the order exists and belongs to the user
    const order = await prisma.order.findUnique({
      where: { id: orderId }
    });

    if (!order || order.buyerId !== userId || order.productId !== productId) {
      return res.status(400).json({
        success: false,
        error:({
          code: 'VAL_001',
          message: 'Invalid order or product',
          statusCode: 400
        })
      });
    }

    // Check if order is delivered
    if (order.status !== 'DELIVERED') {
      return res.status(400).json({
        success: false,
        error:({
          code: 'VAL_001',
          message: 'Can only review delivered orders',
          statusCode: 400
        })
      });
    }

    const product = await prisma.product.findUnique({
      where: { id: productId }
    });

    const review = await prisma.review.create({
      data: {
        productId,
        orderId,
        reviewerId: userId,
        sellerId: product.sellerId,
        rating,
        title,
        body,
        images: images || [],
        isVerified: true
      }
    });

    logger.info(`Review ${review.id} created by user ${userId} for product ${productId}`);

    res.status(201).json({
      success: true,
      data: review
    });
  } catch (error) {
    logger.error('Failed to create review:', error);
    res.status(500).json({
      success: false,
      error:({
        code: 'INT_001',
        message: 'Failed to create review',
        statusCode: 500
      })
    });
  }
}

/**
 * Get reviews for a product
 */
async function getProductReviews(req, res) {
  try {
    const { productId } = req.params;

    const reviews = await prisma.review.findMany({
      where: { productId },
      include: {
        reviewer: {
          select: { id: true, firstName: true, lastName: true, avatarUrl: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json({
      success: true,
      data: reviews
    });
  } catch (error) {
    logger.error('Failed to get product reviews:', error);
    res.status(500).json({
      success: false,
      error:({
        code: 'INT_001',
        message: 'Failed to get reviews',
        statusCode: 500
      })
    });
  }
}

/**
 * Get reviews for a seller
 */
async function getSellerReviews(req, res) {
  try {
    const { sellerId } = req.params;

    const reviews = await prisma.review.findMany({
      where: { sellerId },
      include: {
        product: true,
        reviewer: {
          select: { id: true, firstName: true, lastName: true, avatarUrl: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json({
      success: true,
      data: reviews
    });
  } catch (error) {
    logger.error('Failed to get seller reviews:', error);
    res.status(500).json({
      success: false,
      error:({
        code: 'INT_001',
        message: 'Failed to get reviews',
        statusCode: 500
      })
    });
  }
}

module.exports = {
  createProduct,
  getSchoolProducts,
  getSellerProducts,
  getProduct,
  updateProduct,
  deleteProduct,
  createOrder,
  getBuyerOrders,
  getSellerOrders,
  updateOrderStatus,
  createReview,
  getProductReviews,
  getSellerReviews
};
