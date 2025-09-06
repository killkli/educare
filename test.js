import { AutoModel, AutoTokenizer, matmul } from "@huggingface/transformers";

// Download from the 🤗 Hub
const model_id = "onnx-community/embeddinggemma-300m-ONNX";
const tokenizer = await AutoTokenizer.from_pretrained(model_id);
const model = await AutoModel.from_pretrained(model_id, {
  dtype: "fp32", // Options: "fp32" | "q8" | "q4"
});

// Run inference with queries and documents
const prefixes = {
  query: "task: search result | query: ",
  document: "title: none | text: ",
};
const query = prefixes.query + "Which planet is known as the Red Planet?";
const documents = [
  "Venus is often called Earth's twin because of its similar size and proximity.",
  "Mars, known for its reddish appearance, is often referred to as the Red Planet.",
  "Jupiter, the largest planet in our solar system, has a prominent red spot.",
  "Saturn, famous for its rings, is sometimes mistaken for the Red Planet.",
].map((x) => prefixes.document + x);

const inputs = await tokenizer([query, ...documents], { padding: true });
const { sentence_embedding } = await model(inputs);

// Compute similarities to determine a ranking
const scores = await matmul(sentence_embedding, sentence_embedding.transpose(1, 0));
const similarities = scores.tolist()[0].slice(1);
console.log(similarities);
// [ 0.30109718441963196, 0.6358831524848938, 0.4930494725704193, 0.48887503147125244 ]

// Convert similarities to a ranking
const ranking = similarities.map((score, index) => ({ index, score })).sort((a, b) => b.score - a.score);
console.log(ranking);
// [
//   { index: 1, score: 0.6358831524848938 },
//   { index: 2, score: 0.4930494725704193 },
//   { index: 3, score: 0.48887503147125244 },
//   { index: 0, score: 0.30109718441963196 }
// ]

