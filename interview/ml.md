# ML interview questions

### What is the bias-variance trade-off?
<!-- level: basic; kind: concept; ref: https://scikit-learn.org/stable/auto_examples/model_selection/plot_underfitting_overfitting.html -->
Expected error splits into bias (error from overly simple assumptions), variance (sensitivity to the particular training sample) and irreducible noise. A high-bias model underfits: training and validation error are both high. A high-variance model overfits: training error is low, validation error is much higher.

Increasing capacity lowers bias and raises variance. You manage the trade-off with more data, regularisation, simpler or more flexible models, ensembling (bagging reduces variance, boosting reduces bias) and early stopping. Diagnose with learning curves: a persistent gap between training and validation curves means variance; both curves plateauing high means bias.

Common wrong answer: "more data always fixes it". More data helps variance, not bias.

### How do you detect and prevent overfitting?
<!-- level: basic; kind: concept; ref: https://scikit-learn.org/stable/modules/cross_validation.html -->
Overfitting shows as strong training performance and clearly worse performance on held-out data. Detect it with a validation set or k-fold cross-validation and learning curves. Prevent it with more or augmented data, simpler models, L1/L2 regularisation, dropout, early stopping, feature selection, pruning for trees, and ensembling.

Keep a final test set that you touch once; repeated tuning against it leaks information and overfits the test set too. For time series, use time-ordered splits rather than random shuffling.

Interview tip: mention data leakage as the sneakier cause of "too good" results, for example scaling or imputing before splitting, or duplicate rows across splits.

### Explain precision, recall and when to prefer each.
<!-- level: basic; kind: concept; ref: https://scikit-learn.org/stable/modules/model_evaluation.html -->
Precision is the fraction of predicted positives that are correct: TP / (TP + FP). Recall is the fraction of actual positives found: TP / (TP + FN). F1 is their harmonic mean.

Prefer precision when false positives are costly, such as flagging legitimate transactions as fraud and blocking customers, or sending spam to the inbox's trusted folder. Prefer recall when misses are costly, such as cancer screening or security alerts. The decision threshold moves you along the precision-recall curve, so pick it from business costs, not the default 0.5.

For imbalanced classes accuracy is misleading: a model predicting "no fraud" always is 99.9% accurate and useless. Report precision-recall AUC or per-class metrics.

### What is regularisation and how do L1 and L2 differ?
<!-- level: intermediate; kind: concept; ref: https://scikit-learn.org/stable/modules/linear_model.html#ridge-regression-and-classification -->
Regularisation adds a penalty on model complexity to the loss, discouraging large weights and reducing overfitting. L2 (ridge, weight decay) adds the sum of squared weights; it shrinks all weights smoothly toward zero and handles correlated features by sharing weight. L1 (lasso) adds the sum of absolute weights; its geometry produces exact zeros, so it performs feature selection and yields sparse models. Elastic net mixes both.

The strength is a hyperparameter, tuned by cross-validation. Features must be scaled first, otherwise the penalty treats features unequally.

Pitfall: forgetting that regularisation strength in scikit-learn's LogisticRegression is the inverse parameter C, so smaller C means stronger regularisation.

### How do random forests and gradient boosting differ?
<!-- level: intermediate; kind: concept; ref: https://scikit-learn.org/stable/modules/ensemble.html -->
A random forest trains many deep trees independently on bootstrap samples with random feature subsets and averages them. It reduces variance, is robust, needs little tuning and trains in parallel. Gradient boosting builds shallow trees sequentially, each fitting the residual errors (negative gradient of the loss) of the ensemble so far, scaled by a learning rate. It reduces bias and often reaches higher accuracy on tabular data, but is more sensitive to hyperparameters (learning rate, number of trees, depth) and can overfit without early stopping.

Libraries like XGBoost, LightGBM and CatBoost add regularisation, histogram-based speed and categorical handling.

Interview tip: for tabular data, gradient-boosted trees are usually the strong baseline; neural networks win more often on images, text and audio.

### What is cross-validation and when does it fail?
<!-- level: intermediate; kind: concept; ref: https://scikit-learn.org/stable/modules/cross_validation.html -->
In k-fold cross-validation you split data into k folds, train on k-1, validate on the remaining one, rotate, and average the scores. It gives a more stable estimate than one split and uses data efficiently. Stratified folds preserve class ratios.

It fails when the independence assumption breaks. Time series needs forward-chaining splits to avoid training on the future. Grouped data (multiple rows per patient or user) needs group k-fold, otherwise the same entity appears in train and validation and scores are inflated. Preprocessing and feature selection must be fit inside each fold, ideally with a pipeline, to avoid leakage.

Also keep a separate final test set; cross-validation used for tuning gives an optimistically biased estimate.

### What is the difference between bagging and boosting?
<!-- level: intermediate; kind: concept; ref: https://scikit-learn.org/stable/modules/ensemble.html -->
Both combine weak learners, but differently. Bagging trains learners in parallel on bootstrap resamples and averages or votes; since errors are partly independent, averaging reduces variance. It works best with high-variance learners such as deep trees. Boosting trains learners sequentially, each focusing on what earlier ones got wrong (reweighting in AdaBoost, fitting gradients in gradient boosting), mainly reducing bias.

Bagging is hard to overfit by adding more models; boosting can overfit with too many rounds, so use a small learning rate and early stopping on a validation set. Stacking is a third approach: a meta-model learns how to combine base model predictions.

### How does a transformer differ from an RNN?
<!-- level: intermediate; kind: concept; ref: https://arxiv.org/abs/1706.03762 -->
An RNN processes tokens sequentially, carrying a hidden state forward. This makes training hard to parallelise and long-range information must survive many steps, so gradients vanish and memory fades, even with LSTM or GRU gates. A transformer uses self-attention so every token directly attends to every other token in one step, and all positions are computed in parallel on GPUs, which is why it scales to huge datasets.

The costs: attention is quadratic in sequence length, and position must be encoded explicitly. At generation time a decoder-only transformer produces one token at a time, using a KV cache to avoid recomputation.

Interview tip: mention newer state-space and linear-attention models exist that target the quadratic cost, but transformers remain dominant.

### What are embeddings and how are they used?
<!-- level: basic; kind: concept; ref: https://developers.google.com/machine-learning/crash-course/embeddings -->
An embedding is a learned dense vector representing an item so that similar items are near each other. Words, sentences, images, users and products can all be embedded. The training objective defines similarity: for example contrastive training pulls matching query-document pairs together.

Uses: semantic search, retrieval for RAG, recommendation, clustering, deduplication, and as input features for downstream classifiers. Compare vectors with cosine similarity or dot product and store them in a vector index for fast approximate nearest neighbour search.

Pitfall: embeddings from different models are not interchangeable; if you change the model you must re-embed everything.

### Explain RAG and why you would use it over fine-tuning.
<!-- level: intermediate; kind: concept; ref: https://arxiv.org/abs/2005.11401 -->
Retrieval-augmented generation fetches relevant documents at query time and gives them to an LLM as context. Documents are chunked, embedded and indexed; the query is embedded, top chunks are retrieved (often hybrid with keyword search plus a reranker), and the model answers from them with citations.

Prefer RAG when knowledge is private, large or changing: updating means re-indexing, not retraining; access control can be applied per document; answers are traceable. Fine-tuning is better for teaching style, format or a narrow skill, and is poor at reliably storing facts.

Main failure modes are poor retrieval (wrong chunk size, missing keywords), context overload, and the model ignoring the context. Evaluate retrieval and generation separately.

### What is a vector database and how does ANN search work?
<!-- level: intermediate; kind: concept; ref: https://github.com/pgvector/pgvector -->
A vector database indexes embeddings and returns the nearest vectors to a query, with metadata filtering. Brute-force search is exact but linear in dataset size. Approximate nearest neighbour indexes trade a little recall for much lower latency: HNSW navigates a multi-layer proximity graph, IVF restricts search to the nearest clusters, and product quantisation compresses vectors to save memory.

You tune recall against latency and memory, and measure recall versus exact search on a sample. Choose distance metric to match the embedding model. Filtering combined with ANN can reduce result counts, so check how the engine handles pre- versus post-filtering. pgvector is a reasonable choice when data already lives in PostgreSQL and scale is moderate.

### What is LoRA and why is it popular?
<!-- level: advanced; kind: concept; ref: https://huggingface.co/docs/peft/index -->
LoRA freezes the pretrained weights and trains small low-rank matrices added to selected weight matrices, typically attention projections. Because the update is the product of two thin matrices with rank r, trainable parameters are a tiny fraction of the model, so memory for gradients and optimizer state drops sharply and training fits on far smaller hardware.

Adapters are small files, so you can keep one base model and swap adapters per task or customer, or merge the adapter into the weights for zero extra inference latency. QLoRA combines it with a 4-bit quantised base. Quality is usually close to full fine-tuning for task adaptation, though full fine-tuning may win when large behavioural shifts are needed.

### What is temperature in LLM sampling?
<!-- level: basic; kind: concept; ref: https://huggingface.co/docs/transformers/generation_strategies -->
Temperature rescales the model's logits before softmax. Values below 1 sharpen the distribution so high-probability tokens dominate; values above 1 flatten it, making unlikely tokens more probable. At 0 (or near it) decoding is effectively greedy. Use low temperature for extraction, classification, code and factual answers, and higher for creative generation.

It is usually combined with top-p or top-k truncation, which cut off the unlikely tail. Change one control at a time. Even at temperature 0, outputs may vary slightly across runs because of floating-point and batching nondeterminism, so do not rely on bitwise reproducibility.

### How do you reduce hallucinations in an LLM application?
<!-- level: intermediate; kind: concept; ref: https://arxiv.org/abs/2311.05232 -->
Layer several controls. Ground the model in supplied or retrieved sources and instruct it to answer only from them. Require quoted citations and verify they exist in the source. Permit and reward "I don't know". Use tools for calculations and live data. Keep temperature low for factual tasks. Add automated checks, such as schema validation or a second model pass that tests whether each claim is supported.

Measure it: build an evaluation set including unanswerable and false-premise questions and track groundedness. For high-stakes domains add human review.

Wrong answer: "RAG eliminates hallucination". It reduces it but the model can still misquote or ignore context.

### What is prompt engineering and what techniques matter most?
<!-- level: basic; kind: concept; ref: https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/overview -->
It is designing model inputs to get reliable, correctly formatted outputs. The highest-impact techniques are clear explicit instructions, supplying context, specifying output format (ideally a schema), few-shot examples for style and edge cases, delimiting untrusted data, and asking for step-by-step reasoning on multi-step problems. Break complex tasks into a chain of smaller prompts.

The professional part is evaluation: keep a test set, change one thing at a time, version prompts, and compare metrics rather than impressions. Also test against model upgrades, since a prompt tuned for one model can regress on another.

### Explain data drift versus concept drift.
<!-- level: intermediate; kind: concept; ref: https://cloud.google.com/architecture/mlops-continuous-delivery-and-automation-pipelines-in-machine-learning -->
Data (covariate) drift means the distribution of inputs changes, for example a new customer segment or a sensor recalibration, while the input-to-output relationship may still hold. Concept drift means the relationship itself changes, for example fraudsters adapt, so the same inputs now imply different labels. Label drift is a change in class proportions.

Detect input drift with statistical tests or population stability index on features and predictions. Concept drift needs labels, so track delayed ground-truth performance and proxy business metrics. Responses include retraining on recent data, sliding windows, scheduled or triggered retraining pipelines, and fallback rules. Drift does not automatically mean the model is worse, so confirm with performance before acting.

### What is training-serving skew?
<!-- level: intermediate; kind: concept; ref: https://cloud.google.com/architecture/mlops-continuous-delivery-and-automation-pipelines-in-machine-learning -->
Training-serving skew is a difference between how features are computed or distributed at training time and at serving time, which silently degrades production accuracy. Typical causes: separate code paths (a pandas notebook for training, a service reimplementation for serving), different null or default handling, time-travel leakage where training features use information not available at prediction time, and stale online features.

Prevent it by sharing feature code or using a feature store with point-in-time correct joins, packaging preprocessing inside the model artifact, logging serving features and comparing them with training distributions, and testing the serving path with replayed training rows to confirm identical predictions.

### What is the difference between a bi-encoder and a cross-encoder?
<!-- level: advanced; kind: concept; ref: https://www.sbert.net/examples/applications/retrieve_rerank/README.html -->
A bi-encoder embeds the query and each document independently into vectors; similarity is a cheap dot product, and document vectors can be precomputed and indexed, so it scales to millions of items for first-stage retrieval. A cross-encoder feeds query and document together into one transformer so every query token attends to every document token, producing a single relevance score. It is considerably more accurate but needs a forward pass for every pair, so it cannot score a whole corpus.

The standard design is retrieve-then-rerank: bi-encoder (often with BM25) retrieves tens to hundreds of candidates, a cross-encoder reorders them. Latency budget decides how many to rerank.

### How do you evaluate a classification model on imbalanced data?
<!-- level: intermediate; kind: concept; ref: https://scikit-learn.org/stable/modules/model_evaluation.html#precision-recall-f-measure-metrics -->
Avoid accuracy. Use the confusion matrix, per-class precision and recall, F1 or F-beta (beta above 1 favours recall), precision-recall AUC, and for ranking tasks ROC AUC with care, since ROC can look good when positives are rare. Choose the operating threshold from the cost of false positives versus false negatives, and report the metrics at that threshold.

For training, options include class weights, resampling (SMOTE or undersampling, applied only to the training folds), and anomaly detection framing. Use stratified splits so every fold contains minority examples. Calibrate probabilities if downstream decisions use them as real probabilities.

### What is the curse of dimensionality?
<!-- level: intermediate; kind: concept; ref: https://scikit-learn.org/stable/modules/decomposition.html -->
As the number of features grows, data becomes sparse relative to the space it occupies. Distances between points concentrate, so nearest and farthest neighbours become hard to distinguish, hurting k-NN and clustering. The number of samples needed to cover the space grows exponentially, so models with many features overfit unless regularised or given much more data.

Responses: feature selection, dimensionality reduction (PCA, autoencoders, UMAP for visualisation), regularisation, models with built-in selection such as L1 or trees, and domain-driven features. Note that dense embeddings are high-dimensional yet work well because real data lies near a low-dimensional manifold.

### What is MLOps and why does it matter?
<!-- level: basic; kind: concept; ref: https://mlflow.org/docs/latest/model-registry.html -->
MLOps is the practice of reliably building, deploying and operating ML systems. Unlike ordinary software, behaviour depends on data as well as code, and quality decays as the world changes. It covers versioning of data, code and models; reproducible training pipelines; experiment tracking; a model registry; automated tests and quality gates; safe release (shadow, canary, A/B); serving; monitoring for latency, data quality, drift and performance; and retraining triggers.

The payoff is repeatability and speed: any model can be rebuilt, rolled back, and audited, and incidents are found by monitoring instead of by customers. A team with only notebooks and manual deployments has a prototype, not a product.
