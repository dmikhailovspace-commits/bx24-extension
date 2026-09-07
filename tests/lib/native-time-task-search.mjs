export async function selectTimeTrackerTask(page, taskId) {
 const selected = page.locator('.pena-native-time-tracker-selected');
 if (await selected.isVisible()) await selected.click();
 await page.locator('.pena-native-time-tracker-search').fill(String(taskId));
 await page.locator(`#pena-time-tracker-task-option-${taskId}`).click();
}
