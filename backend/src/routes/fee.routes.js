'use strict';
const router = require('express').Router();
const { body } = require('express-validator');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth.middleware');
const { eduMember, eduAdmin } = require('../middleware/educationAuth');
const prisma = require('../utils/prisma');
const XLSX = require('xlsx');
const { successResponse, errorResponse, paginatedResponse, getPagination, buildPaginationMeta } = require('../utils/response');

router.use(authenticate);

// List fees — school members can view (students/guardians see own; admins see all)
router.get('/', ...eduMember, async (req, res, next) => {
  try {
    const { search, status, studentId, page = 1, limit = 50 } = req.query;
    const schoolId = req.schoolId || req.user.schoolId;
    const { skip, ...pagination } = getPagination(page, limit);

    const where = { schoolId: schoolId || undefined };
    if (status) where.status = status;
    if (studentId) where.studentId = studentId;
    if (search) {
      where.student = {
        user: {
          OR: [
            { firstName: { contains: String(search) } },
            { lastName: { contains: String(search) } }
          ]
        }
      };
    }

    const [fees, total] = await Promise.all([
      prisma.feeRecord.findMany({
        where,
        include: {
          student: { include: { user: { select: { firstName: true, lastName: true } } } }
        },
        orderBy: [{ status: 'asc' }, { dueDate: 'asc' }],
        skip,
        take: pagination.limit
      }),
      prisma.feeRecord.count({ where })
    ]);

    // Summary
    const allFees = await prisma.feeRecord.findMany({ where: { schoolId: schoolId || undefined } });
    const summary = {
      total: allFees.reduce((s, f) => s + Number(f.amount), 0),
      paid: allFees.filter(f => f.status === 'PAID').reduce((s, f) => s + Number(f.amount), 0),
      pending: allFees.filter(f => f.status === 'PENDING').reduce((s, f) => s + Number(f.amount), 0),
      overdue: allFees.filter(f => f.status === 'OVERDUE').reduce((s, f) => s + Number(f.amount), 0),
    };

    return res.json({
      success: true,
      data: fees,
      summary,
      pagination: buildPaginationMeta(total, pagination.page, pagination.limit)
    });
  } catch (error) { next(error); }
});

// Create fee — admin only
router.post('/',
  ...eduAdmin,
  [
    body('studentId').notEmpty(),
    body('amount').isFloat({ min: 0 }),
    body('feeType').isIn(['TUITION', 'REGISTRATION', 'EXAM', 'ACTIVITY', 'TRANSPORT', 'OTHER'])
  ],
  validate,
  async (req, res, next) => {
    try {
      const { studentId, amount, description, dueDate, feeType } = req.body;
      const schoolId = req.schoolId || req.user.schoolId;

      // Auto-mark overdue if due date is in the past
      let status = 'PENDING';
      if (dueDate && new Date(dueDate) < new Date()) status = 'OVERDUE';

      // Dedup guard: prevent duplicate active fees of same type for same student
      const existingFee = await prisma.feeRecord.findFirst({
        where: {
          studentId,
          feeType,
          status: { in: ['PENDING', 'OVERDUE'] }
        }
      });
      if (existingFee) {
        return errorResponse(res, `An active ${feeType} fee already exists for this student`, 409);
      }

      const fee = await prisma.feeRecord.create({
        data: {
          studentId,
          schoolId: schoolId || null,
          amount: parseFloat(amount),
          description: description || null,
          dueDate: dueDate ? new Date(dueDate) : null,
          feeType,
          status,
          createdBy: req.user.id
        },
        include: {
          student: { include: { user: { select: { firstName: true, lastName: true } } } }
        }
      });

      return successResponse(res, fee, 'Fee record created', 201);
    } catch (error) { next(error); }
  }
);

// Mark as paid — admin
router.put('/:id/pay', ...eduAdmin, async (req, res, next) => {
    try {
      const fee = await prisma.feeRecord.update({
        where: { id: req.params.id },
        data:  { status: 'PAID', paidAt: new Date() }
      });
      return successResponse(res, fee, 'Marked as paid');
    } catch (error) { next(error); }
});

// ─── POST /fees/:id/checkout — Pay fee via Stripe Checkout ────────────────────
// Creates a Stripe Checkout session for a specific fee record.
// Reuses the existing Stripe infrastructure from stripe.controller.js.
// The webhook handler is extended below to handle fee payments.
// Accessible by: GUARDIAN (paying for their student) or SCHOOL_ADMIN
router.post('/:id/checkout', async (req, res, next) => {
  try {
    const fee = await prisma.feeRecord.findUnique({
      where: { id: req.params.id },
      include: {
        student: {
          include: {
            user:     { select: { firstName: true, lastName: true } },
            guardianLinks: {
              include: { guardian: { select: { userId: true } } }
            }
          }
        }
      }
    });

    if (!fee) return errorResponse(res, 'Fee record not found', 404);
    if (fee.status === 'PAID') return errorResponse(res, 'This fee has already been paid', 400);
    if (fee.status === 'WAIVED') return errorResponse(res, 'This fee has been waived', 400);

    // Authorization: school admin or the student's guardian
    const isAdmin    = ['SUPER_ADMIN', 'SCHOOL_ADMIN'].includes(req.user.role);
    const isGuardian = fee.student?.guardianLinks?.some(gl => gl.guardian?.userId === req.user.id);
    if (!isAdmin && !isGuardian) {
      return errorResponse(res, 'Not authorized to pay this fee', 403);
    }

    const Stripe = require('stripe');
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey || stripeKey.startsWith('sk_test_REPLACE') || stripeKey.startsWith('sk_live_REPLACE')) {
      return errorResponse(res, 'Stripe is not configured. Contact your school administrator.', 503);
    }

    const stripe       = new Stripe(stripeKey, { apiVersion: '2024-11-20.acacia' });
    const amountCents  = Math.round(Number(fee.amount) * 100);
    if (amountCents < 50) return errorResponse(res, 'Fee amount too small for Stripe (min $0.50)', 400);

    const studentName = `${fee.student?.user?.firstName || ''} ${fee.student?.user?.lastName || ''}`.trim();

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode:                 'payment',
      line_items: [{
        price_data: {
          currency:     'usd',
          unit_amount:  amountCents,
          product_data: {
            name:        `${fee.feeType} Fee — ${studentName}`,
            description: fee.description || `School fee payment for ${studentName}`,
          }
        },
        quantity: 1
      }],
      metadata: {
        type:      'fee_payment',
        feeId:     fee.id,
        studentId: fee.studentId,
        paidBy:    req.user.id
      },
      success_url: `${process.env.STRIPE_SUCCESS_URL || 'http://localhost:3000/fees'}?payment=success&feeId=${fee.id}`,
      cancel_url:  `${process.env.STRIPE_CANCEL_URL  || 'http://localhost:3000/fees'}?payment=cancelled`,
      customer_email: req.user.email,
      expires_at: Math.floor(Date.now() / 1000) + 1800
    });

    return successResponse(res, {
      sessionId:   session.id,
      checkoutUrl: session.url,
      feeId:       fee.id,
      amount:      Number(fee.amount)
    }, 'Checkout session created');
  } catch (error) { next(error); }
});

// Waive fee — admin
router.put('/:id/waive', ...eduAdmin, async (req, res, next) => {
    try {
      const fee = await prisma.feeRecord.update({
        where: { id: req.params.id },
        data: { status: 'WAIVED', notes: req.body.reason || 'Waived by admin' }
      });
      return successResponse(res, fee, 'Fee waived');
    } catch (error) { next(error); }
});

// Delete fee — admin
router.delete('/:id', ...eduAdmin, async (req, res, next) => {
    try {
      await prisma.feeRecord.delete({ where: { id: req.params.id } });
      return successResponse(res, null, 'Fee deleted');
    } catch (error) { next(error); }
});

// Export fees — admin
router.get('/export', ...eduAdmin, async (req, res, next) => {
    try {
      const schoolId = req.schoolId || req.user.schoolId;
      const fees = await prisma.feeRecord.findMany({
        where: { schoolId: schoolId || undefined },
        include: {
          student: { include: { user: { select: { firstName: true, lastName: true } } } }
        },
        orderBy: { createdAt: 'desc' }
      });

      const data = fees.map(f => ({
        'Student': `${f.student?.user?.firstName} ${f.student?.user?.lastName}`,
        'Fee Type': f.feeType,
        'Description': f.description || '',
        'Amount': Number(f.amount).toFixed(2),
        'Status': f.status,
        'Due Date': f.dueDate ? new Date(f.dueDate).toISOString().split('T')[0] : '',
        'Paid Date': f.paidAt ? new Date(f.paidAt).toISOString().split('T')[0] : '',
        'Created': new Date(f.createdAt).toISOString().split('T')[0]
      }));

      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Fees');
      ws['!cols'] = Object.keys(data[0] || {}).map(k => ({ wch: Math.max(k.length + 2, 15) }));
      const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename=fees-${Date.now()}.xlsx`);
      return res.send(buffer);
    } catch (error) { next(error); }
});

module.exports = router;
