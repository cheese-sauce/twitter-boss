//Adds a new tag to the twitter stream
function addTweet(tag){
	//If the stop stream button was hidden it is now revealed due
	//to a new stream being added
	document.getElementById("stop").style.visibility = "visible";
	//Emit the tag to the server
	socket.emit('addTweet', tag);
	//Clear the text field
	document.getElementById('addTag').value = "";
}

//Redirects the client and ends the first tag via the URL to the next page
//so the tag can be used by the new socket
function firstTweet(tag){
	//Encode the tag so that it can be passed across the url
	tag = encodeURI(tag);
	//redirect the client
	window.location.href = "?streaming=true&tag=" + tag;
}

//Initiates a crazy amount of load on the server
function loadMe(){
	socket.emit('loadMe', 'hi');
}

//Check's whether the url contains a tag, if so it emits
//that tag to the server to start the first stream
function validateSocket(){
	//Turns the url into a string
	var url = window.location + '';
	//Splits it at the = sign and grabs the third part which
	//will either be the tag or nothing
	var tag = url.split('=')[2];
	//If the tag exists
	if (tag !== undefined){
		//emit to the server
		socket.emit('firstTweet', tag);
	}
}

//Destroys the current streams
function stopStream(){
	//Hides the stop button as there wont be any streams to stop now
	document.getElementById("stop").style.visibility = "hidden";
	//emit to the server to initiate the stop function
	socket.emit('endStream', 'hi');
}

//Makes the server add the top entities to the stream
//Severely increasing load
function addEntities(){
	socket.emit('addEntities', 'hi');
}

//Initiates a pie chart for both streams
var pieChartNew;
var pieChartOld;
//Initiate two objects that store the pie chart data
var pieDataOld = [
	{
		"label": "Positive",
		"value": 1,
		"color": "#4CAF50"
	},
	{
		"label": "Neutral",
		"value": 1,
		"color": "#2196F3"
	},
	{
		"label": "Negative",
		"value": 1,
		"color": "#F44336"
	}
];
var pieDataNew = [
	{
		"label": "Positive",
		"value": 1,
		"color": "#4CAF50"
	},
	{
		"label": "Neutral",
		"value": 1,
		"color": "#2196F3"
	},
	{
		"label": "Negative",
		"value": 1,
		"color": "#F44336"
	}
];

//Variables to easily track items on the page
var liveList;
var oldList;
var liveScroll;
var oldScroll;
var liveAverage;
var oldAverage;

//Once the page has loaded grab the elements
//These are not all used
window.onload = function(e){
	liveList = document.getElementById("liveTweets");
	oldList = document.getElementById("oldTweets");

	liveScroll = document.getElementById("liveScroll");
	oldScroll = document.getElementById("oldScroll");
	loadScroll = document.getElementById("loadScroll");

	liveAverage = document.getElementById('liveAverage').innerHTML;
	oldAverage = document.getElementById('oldAverage').innerHTML;
};

//Keeps the twitter stream at the bottom (newest tweets)
//
//I had it so if the user scrolled it would break this, but that
//became quickly annoying, so i left it to just always lock to the
//bottom when a new tweet was added
function updateScroll(list){
	list.scrollTop = list.scrollHeight;
}

//Listener for when the server edmits a tweet for the load segment
socket.on('loadTweet', function(data){
	//Append the tweet in the form of a list item
	$("#loadTweets").append("<li class='plain''><p><strong> USER: " + data.user + " || Sheep Rating: " + data.sheepRating + "% </strong></p><p><strong>" + data.text + "</strong></p></li>");
	//Update the scroll bar to the bottom
	updateScroll(loadScroll);
	//Update the tweet count
	document.getElementById('loadTitle').innerHTML = "M-m-maximum Tweeterdrive || Tweets: " + data.number;
});
//Listener for when the server emits a new tweet from the live stream
socket.on('newTweet', function (data) {
	var colour;
	//Set the average sentiment
	liveAverage = "Average Sentiment: " + data.averageType + " || " + data.averageSentiment;
	//Determine which background colour to set the tweet according to it's sentiment
	switch(data.sentimentType){
		case "positive":
			colour = "green";
			break;
		case "negative":
			colour = "red";
			break;
		case "neutral":
			colour = "blue";
			break;
	}
	//Updates the chart with this tweet's data
	updatePieChart(data.sentimentType, pieChartNew, pieDataNew);
	//Append the tweet in the form of a list item
	$("#liveTweets").append("<li class='" + colour + "'><p><strong> USER: " + data.user + " || Sheep Rating: " + data.sheepRating + "% || SENTIMENT: " + data.sentimentType +
		" || SCORE: " + data.sentimentScore + " || " + data.entities + "</strong></p><p><strong>" + data.text + "</strong></p></li>");
	//Update the scroll bar to the bottom
	updateScroll(liveScroll);

	//Update the tweet count
	document.getElementById('newTitle').innerHTML = "Live Stream || Tweets: " + data.tweetTotal;
});
//Listener for when the server emits a tweet from the Last Week
socket.on('lastWeeks', function (data) {
	var colour;
	//Set the average
	oldAverage = "Average Sentiment: " + data.averageType + " || " + data.averageSentiment;
	//Determine which background colour to set the tweet according to it's sentiment
	switch(data.sentimentType){
		case "positive":
			colour = "green";
			break;
		case "negative":
			colour = "red";
			break;
		case "neutral":
			colour = "blue";
			break;
	}
	//Update the pie chart
	updatePieChart(data.sentimentType, pieChartOld, pieDataOld);
	//Append the tweet in the form of a list item
	$("#oldTweets").append("<li class='" + colour + "'><p><strong> USER: " + data.user + " || SENTIMENT: " + data.sentimentType +
		" || SCORE: " + data.sentimentScore + " || " + data.entities + "</strong></p><p><strong>" + data.text + "</strong></p></li>");
	//Update the scroll bar to the bottom
	updateScroll(oldScroll);

	//Update the tweet count
	document.getElementById('oldTitle').innerHTML = "LAST WEEK || Tweets: " + data.tweetTotal;
});
//Listener to update the Top 10 entity list for the Last Week
socket.on('updateOldEntities', function (data) {
	//Clear the current list
	document.getElementById("oldEntities").innerHTML = "";
	//for each list item append it to the list
	for (var i = 0; i < data.length; i++){
		$("#oldEntities").append("<li><p><strong>" + data[i].name + ":  " + data[i].value + "</strong></p></li>");
	}
});
//Listener to update the Top 10 entity list for the live stream
socket.on('updateNewEntities', function (data) {
	//Clear the current list
	document.getElementById("newEntities").innerHTML = "";
	//for each list item append it to the list
	for (var i = 0; i < data.length; i++){
		$("#newEntities").append("<li><p><strong>" + data[i].name + ":  " + data[i].value + "</strong></p></li>");
	}
});

//Updates the pie chart with the data from a tweet
function updatePieChart(sentiment,chart, data){
	//Depending on what the sentiment of the tweet is
	//increment the correct value
	switch(sentiment){
		case "positive":
			data[0].value += 1;
			break;
		case "neutral":
			data[1].value += 1;
			break;
		case "negative":
			data[2].value += 1;
			break;
	}
	//Redraw the chart
	chart.updateProp("data.content", data);
}
//Create the charts
function initiateCharts(){
	pieChartOld = new d3pie("pieChartOld", {
		"size": {
			"canvasHeight": 200,
			"canvasWidth": 200,
			"pieOuterRadius": "100%"
		},
		"data": {
			"sortOrder": "value-desc",
			"content": pieDataOld
		},
		"labels": {
			"outer": {
				"format": "none"
			},
			"mainLabel": {
				"fontSize": 11
			},
			"percentage": {
				"color": "#ffffff",
				"decimalPlaces": 0
			},
			"value": {
				"color": "#adadad",
				"fontSize": 11
			},
			"lines": {
				"enabled": true
			},
			"truncation": {
				"enabled": true
			}
		},
		"effects": {
			"pullOutSegmentOnClick": {
				"effect": "linear",
				"speed": 400,
				"size": 8
			},
			"load": {
				"effect": "none"
			}
		},
		"misc": {
			"gradient": {
				"enabled": true,
				"percentage": 100
			}
		}
	});
	pieChartNew = new d3pie("pieChartNew", {
		"title": {
			"text": ""
		},
		"size": {
			"canvasHeight": 200,
			"canvasWidth": 200,
			"pieOuterRadius": "100%"
		},
		"data": {
			"sortOrder": "value-desc",
			"content": pieDataNew
		},
		"labels": {
			"outer": {
				"format": "none"
			},
			"mainLabel": {
				"fontSize": 11
			},
			"percentage": {
				"color": "#ffffff",
				"decimalPlaces": 0
			},
			"value": {
				"color": "#adadad",
				"fontSize": 11
			},
			"lines": {
				"enabled": true
			},
			"truncation": {
				"enabled": true
			}
		},
		"effects": {
			"pullOutSegmentOnClick": {
				"effect": "linear",
				"speed": 400,
				"size": 8
			},
			"load": {
				"effect": "none"
			}
		},
		"misc": {
			"gradient": {
				"enabled": true,
				"percentage": 100
			}
		}
	});
}



