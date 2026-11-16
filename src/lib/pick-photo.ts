import * as ImagePicker from "expo-image-picker";
import type { TutorClient } from "./client";
import type { Photo } from "./drafts";
import { ownTemporaryFile } from "./temporary-files";

export async function pickQuestionPhoto(api: TutorClient, camera: boolean, conversation = ""): Promise<Photo | undefined> {
  if (camera && !(await ImagePicker.requestCameraPermissionsAsync()).granted)
    throw new Error("需要相机权限，也可以从相册选择题目照片。");
  const result = await (camera ? ImagePicker.launchCameraAsync : ImagePicker.launchImageLibraryAsync)({
    mediaTypes: ["images"], allowsEditing: true, base64: true, quality: 0.8,
  });
  if (result.canceled) return;
  api.assertOpen();
  const asset = result.assets[0];
  if (!asset.base64) throw new Error("图片未能读取，请重新选择。");
  if (asset.base64.length > 10 * 1024 * 1024) throw new Error("照片较大，请裁剪到一道题再试。");
  const filename = "question.jpg";
  return { uri: await ownTemporaryFile(api, asset.uri, filename, conversation), base64: asset.base64, filename };
}
