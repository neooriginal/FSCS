function calculateCost(json, epochs) {
    //4o mini
    let amountExamples = json.length;
    let averageTokensPer1000 = 0.0030;
    let promptTokens = 88; //max 350 characters

    let totalTokens = 0;
    json.forEach(element => {
        let tokens = textToTokens(JSON.stringify(element));
        totalTokens += tokens + promptTokens;
    });
    totalTokens = totalTokens / json.length;

    let cost = ((amountExamples * totalTokens) * epochs) * (averageTokensPer1000 / 1000);

    return Math.ceil(cost) + 1
}


function textToTokens(text) {
    return text.length / 4;
}

module.exports = {
    calculateCost
}