function calculateFineTuneSettings(N) {
    const hyperparams = calculateHyperparameters(N);

    return {
        n_epochs: Math.floor(hyperparams.epochs), // has to be a whole number
        batch_size: hyperparams.batchSize,
        learning_rate_multiplier: hyperparams.learningRateMultiplier
    }
}

function calculateHyperparameters(numLines) {
    const baselineLines = 5600;
    const baselineEpochs = 5;
    const baselineBatchSize = 11;
    const baselineLR = 0.05;

    // Maximum/Minimum boundaries for our hyperparameters
    const EpochsMAX = 6;
    const EpochsMIN = 6;
    const BatchSizeMAX = 32;
    const LRMAX = 5;    // Lowered from 10 to prevent extreme multipliers on tiny datasets
    const LRMIN = 0.05; // Ensure a minimum learning rate multiplier for huge datasets
    const MIN_BATCH_SIZE = 10;

    // Validate input
    if (numLines < 1) {
        throw new Error("Number of lines must be at least 1.");
    }

    // Calculate ratio and scaling factor based on the baseline dataset size.
    const ratio = numLines / baselineLines;
    const scalingFactor = Math.sqrt(ratio);

    // Adjust epochs with threshold conditions.
    let epochs;
    if (numLines < 500) {
        // For very small datasets, train for more epochs.
        epochs = 10;
    } else if (numLines > 100000) {
        // For huge datasets, use fewer epochs to avoid excessive training.
        epochs = 3;
    } else {
        // Otherwise, use inverse scaling based on the dataset size,
        // but do not exceed a moderate maximum value.
        epochs = baselineEpochs / scalingFactor;
        epochs = Math.min(EpochsMAX, epochs);
    }

    // Batch size scales with the dataset size, with a lower floor to avoid noisy gradients.
    const batchSize = Math.min(
        BatchSizeMAX,
        Math.max(MIN_BATCH_SIZE, Math.round(baselineBatchSize * scalingFactor))
    );

    // Learning rate multiplier scales inversely with dataset size.
    // We ensure it stays within [LRMIN, LRMAX] to maintain training stability.
    let learningRateMultiplier = baselineLR / scalingFactor;
    learningRateMultiplier = Math.max(LRMIN, Math.min(LRMAX, learningRateMultiplier));

    if (epochs < EpochsMIN) epochs = EpochsMIN;

    return {
        epochs: epochs,
        batchSize: batchSize,
        learningRateMultiplier: learningRateMultiplier
    };

}

module.exports = {
    calculateFineTuneSettings
}