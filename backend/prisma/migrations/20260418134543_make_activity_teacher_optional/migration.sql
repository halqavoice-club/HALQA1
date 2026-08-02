-- DropForeignKey
ALTER TABLE `activities` DROP FOREIGN KEY `activities_teacherId_fkey`;

-- AlterTable
ALTER TABLE `activities` MODIFY `teacherId` VARCHAR(191) NULL;

-- AddForeignKey
ALTER TABLE `activities` ADD CONSTRAINT `activities_teacherId_fkey` FOREIGN KEY (`teacherId`) REFERENCES `teachers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
