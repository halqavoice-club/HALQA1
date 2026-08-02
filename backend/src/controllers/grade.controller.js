const prisma = require('../utils/prisma');
const { successResponse, errorResponse, paginatedResponse, getPagination, buildPaginationMeta } = require('../utils/response');

function calculateLetterGrade(percentage, scale) {
  if (percentage === null || percentage === undefined || isNaN(percentage)) return 'F';
  const defaultScale = [
    { min: 97, letter: 'A+' }, { min: 93, letter: 'A' }, { min: 90, letter: 'A-' },
    { min: 87, letter: 'B+' }, { min: 83, letter: 'B' }, { min: 80, letter: 'B-' },
    { min: 77, letter: 'C+' }, { min: 73, letter: 'C' }, { min: 70, letter: 'C-' },
    { min: 67, letter: 'D+' }, { min: 63, letter: 'D' }, { min: 60, letter: 'D-' },
    { min: 0, letter: 'F' }
  ];
  const s = scale || defaultScale;
  const entry = s.find(e => percentage >= e.min);
  return entry ? entry.letter : 'F';
}

function calculateGpa(letterGrade) {
  const map = {
    'A+': 4.0, 'A': 4.0, 'A-': 3.7,
    'B+': 3.3, 'B': 3.0, 'B-': 2.7,
    'C+': 2.3, 'C': 2.0, 'C-': 1.7,
    'D+': 1.3, 'D': 1.0, 'D-': 0.7,
    'F': 0.0
  };
  return map[letterGrade] ?? 0.0;
}

async function createGrade(req, res, next) {
  try {
    const {
      studentId, classId, termId, categoryId, title, type,
      score, maxScore, weight, feedback, dueDate
    } = req.body;

    const safeMax = maxScore && maxScore > 0 ? maxScore : 100;
    const percentage = (score / safeMax) * 100;
    const letterGrade = calculateLetterGrade(percentage);

    const teacher = await prisma.teacher.findFirst({ where: { userId: req.user.id } });

    const grade = await prisma.grade.create({
      data: {
        studentId, classId, termId, categoryId,
        title, type, score, maxScore: safeMax,
        weight: weight || 1.0,
        percentage,
        letterGrade,
        feedback,
        dueDate: dueDate ? new Date(dueDate) : null,
        teacherId: teacher?.id
      },
      include: {
        student: { include: { user: { select: { firstName: true, lastName: true } } } },
        category: true
      }
    });

    return successResponse(res, grade, 'Grade created', 201);
  } catch (error) {
    next(error);
  }
}

async function bulkCreateGrades(req, res, next) {
  try {
    const { classId, termId, categoryId, title, type, maxScore, grades } = req.body;
    // grades: [{ studentId, score, feedback }]

    if (!Array.isArray(grades) || grades.length === 0) {
      return errorResponse(res, 'grades must be a non-empty array', 400);
    }

    const teacher = await prisma.teacher.findFirst({ where: { userId: req.user.id } });
    const safeMax = maxScore && maxScore > 0 ? maxScore : 100;

    const created = await prisma.$transaction(
      grades.map(g => {
        const percentage = (g.score / safeMax) * 100;
        const letterGrade = calculateLetterGrade(percentage);
        return prisma.grade.create({
          data: {
            studentId: g.studentId,
            classId, termId, categoryId,
            title, type,
            score: g.score,
            maxScore: safeMax,
            percentage,
            letterGrade,
            feedback: g.feedback,
            teacherId: teacher?.id
          }
        });
      })
    );

    return successResponse(res, { count: created.length }, 'Grades created', 201);
  } catch (error) {
    next(error);
  }
}

async function getStudentGrades(req, res, next) {
  try {
    const { studentId } = req.params;
    const { classId, termId, type } = req.query;

    const where = { studentId, deletedAt: null };
    if (classId) where.classId = classId;
    if (termId) where.termId = termId;
    if (type) where.type = type;

    const grades = await prisma.grade.findMany({
      where,
      include: {
        class: { select: { id: true, name: true } },
        category: true,
        teacher: { include: { user: { select: { firstName: true, lastName: true } } } }
      },
      orderBy: { gradedAt: 'desc' }
    });

    // Calculate GPA
    const validGrades = grades.filter(g => g.percentage !== null);
    const avgPercentage = validGrades.length > 0
      ? validGrades.reduce((sum, g) => sum + g.percentage, 0) / validGrades.length
      : 0;
    const overallLetter = calculateLetterGrade(avgPercentage);
    const gpa = calculateGpa(overallLetter);

    return successResponse(res, {
      grades,
      summary: {
        average: Math.round(avgPercentage * 100) / 100,
        letterGrade: overallLetter,
        gpa,
        total: grades.length
      }
    }, 'Grades fetched');
  } catch (error) {
    next(error);
  }
}

async function getClassGrades(req, res, next) {
  try {
    const { classId } = req.params;
    const { termId, type, categoryId } = req.query;

    const where = { classId, deletedAt: null };
    if (termId) where.termId = termId;
    if (type) where.type = type;
    if (categoryId) where.categoryId = categoryId;

    const grades = await prisma.grade.findMany({
      where,
      include: {
        student: {
          include: { user: { select: { firstName: true, lastName: true } } }
        },
        category: true
      },
      orderBy: [
        { student: { user: { firstName: 'asc' } } },
        { gradedAt: 'desc' }
      ]
    });

    return successResponse(res, grades, 'Class grades fetched');
  } catch (error) {
    next(error);
  }
}

async function updateGrade(req, res, next) {
  try {
    const { id } = req.params;
    const { score, maxScore, feedback } = req.body;

    const percentage = (score / maxScore) * 100;
    const letterGrade = calculateLetterGrade(percentage);

    const grade = await prisma.grade.update({
      where: { id },
      data: { score, maxScore, percentage, letterGrade, feedback }
    });

    return successResponse(res, grade, 'Grade updated');
  } catch (error) {
    next(error);
  }
}

async function deleteGrade(req, res, next) {
  try {
    const { id } = req.params;
    await prisma.grade.update({ where: { id }, data: { deletedAt: new Date() } });
    return successResponse(res, null, 'Grade deleted');
  } catch (error) {
    next(error);
  }
}

async function getGradeCategories(req, res, next) {
  try {
    const { classId } = req.params;
    const categories = await prisma.gradeCategory.findMany({
      where: { classId },
      orderBy: { name: 'asc' }
    });
    return successResponse(res, categories, 'Categories fetched');
  } catch (error) {
    next(error);
  }
}

async function createGradeCategory(req, res, next) {
  try {
    const { classId, name, type, weight, maxPoints } = req.body;
    const category = await prisma.gradeCategory.create({
      data: { classId, name, type, weight, maxPoints }
    });
    return successResponse(res, category, 'Category created', 201);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  createGrade, bulkCreateGrades, getStudentGrades,
  getClassGrades, updateGrade, deleteGrade,
  getGradeCategories, createGradeCategory
};
