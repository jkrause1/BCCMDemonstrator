#!/usr/bin/env node

var yargs = require("yargs/yargs");
var opcua = require("node-opcua");
var PythonShell = require("python-shell");
var web3 = require("web3");
var os = require("os");
var fs = require("fs");

process.title = "OPCUA-Server for Joy-It Robotarm Robot02";

// Command-Lines Option Names
var portOption = "port";
var applicationNameOption = "applicationName";
var whisperPasswordOption = "whisperPassword";
var whisperTopicOption = "whisperTopic";
var pythonScriptOption = "python";
var updateIntervalOption = "updateInterval";
var webSocketUriOption = "webSocketUri";
var servoCountOption = "servoCount";
var printPythonConsoleOption = "printPythonConsole";
var historyFileOption = "historyFile";

// OPCUA-Eventnames
var opcua_post_initialize = "post_initialize";
var opcua_response = "response";
var opcua_request = "request";

// Python-Shell-Eventnames
var python_message = "message";
var python_close = "close";
var python_error = "error";

// OPCUA-Namespaces
var OPCUAServer = opcua.OPCUAServer;
var OPCUAClient = opcua.OPCUAClient;
var Variant = opcua.Variant;
var DataType = opcua.DataType;
var VariantArrayType = opcua.VariantArrayType;
var StatusCodes = opcua.StatusCodes;
var AttributeIds = opcua.AttributeIds;

// Web3-Variables
var webSocketUri;
var webSocket;
var symKeyId;
var whisperPassword;
var whisperTopic;

// Python-Variables
var pythonScript;
var printPythonConsole;
var pythonOptions = {
    mode: "text",
    pythonOptions: ["-u"],
    args:[]
};

// OPCUA-Variables
var applicationName;
var port;
var servoCount;
var servos;
var server;
var client;
var session;

// History file name
var historyFileName;

// Parsing Command-Line-Options
var argv = yargs(process.argv)
    .wrap(80)
    .help(true)

    .demandOption([portOption])
    .describe(portOption, "On which port to list for incomming connections.")
    .alias("p", portOption)

    .demandOption([pythonScriptOption])
    .describe(pythonScriptOption, "Which python file to execute.")
    .alias("y", pythonScriptOption)

    .demandOption([updateIntervalOption])
    .describe(updateIntervalOption, "At which interval the variables in the OPCUA-Server for the servos should be updated. In ms.")
    .alias("i", updateIntervalOption)

    .demandOption([webSocketUriOption])
    .describe(webSocketUriOption, "The URI to an ethereum-node websocket.")
    .alias("w", webSocketUriOption)

    .string(applicationNameOption)
    .describe(applicationNameOption, "Name of the application")
    .alias("a", applicationNameOption)
    .default(applicationNameOption, "Robotarm OPCUA-Server")

    .string(whisperPasswordOption)
    .describe(whisperPasswordOption, "Password decrypting incoming whisper messages.")
    .alias("x", whisperPasswordOption)
    .default(whisperPasswordOption, "password")

    .string(whisperTopicOption)
    .describe(whisperTopicOption, "Topic of whisper messages to listen to.")
    .alias("t", whisperTopicOption)
    .default(whisperTopicOption, "0x12345678")

    .number(servoCountOption)
    .describe(servoCountOption, "Count of servos for the OPCUA-Server to manage")
    .alias("s", servoCountOption)
    .default(servoCountOption, 6)

    .boolean(printPythonConsoleOption)
    .describe(printPythonConsoleOption, "True, if python console outputs should be printed in the nodejs-console")
    .alias("c", printPythonConsoleOption)
    .default(printPythonConsoleOption, false)

    .string(historyFileOption)
    .describe(historyFileOption, "The file to write history entrys to.")
    .alias("h", historyFileOption)
    .default(historyFileOption, "robotOpcuaHistory")

    .version("0.1")
    .argv;

//#####################################
//###Functions and methods for OPCUA###
//#####################################

function updateServoValue(servoIndex){
    args = ["--Servo=" + (servoIndex+1), "--Method=read"];
    var script = runPythonScript(args);
    
    script.on(python_message, function(message){
	logAndWrite("OPCUA: Servo" + (servoIndex+1) + " updated: " + message);
	servos[servoIndex] = parseFloat(message);
    });
}

function updateServoValues(){
    for( var i = 0; i < servoCount; i++){
	updateServoValue(i);
    }
}

function getServo(servoIndex){
    return servos[servoIndex];
}

function setServo(servoIndex, servoValue){
    args = ["--Servo=" + (servoIndex+1), "--Method=write", "--Value=" + servoValue];
    var script = runPythonScript(args);
    return script;
}

function addOPCUAServoVariable(servoIndex, addressSpace, robot){
    
    return addressSpace.addVariable({
	organizedBy: robot,
	browseName: "Servo" + (servoIndex+1),
	nodeId: "ns=1;s=Servo" + (servoIndex+1),
	dataType: "Float",
	value: {
	    get: function(){
		logAndWrite("OPCUA: Value of servo " + servoIndex + " requested.");
		var result = new Variant({dataType: DataType.Float, value: getServo(servoIndex)});
		return result;
	    },
	    set: function(variant){
		var value = parseFloat(variant.value);
		logAndWrite("OPCUA: Servo " + servoIndex + " changed to " + value);
		setServo(servoIndex, value);
		return StatusCodes.Good;
	    }
	}
    });
}

function moveArmToInitialPosition(){
    var servoIndex = 0;
    var moveFunc = function(err, script){
	servoIndex++;
	if(servoIndex < servoCount)
	    setServo(servoIndex, 1.5).on(python_close, moveFunc);
    }

    setServo(servoIndex, 1.5).on(python_close, moveFunc);
}

function opcuaServerPostInitialize(){
    var addressSpace = server.engine.addressSpace;

    var robot = addressSpace.addFolder(addressSpace.rootFolder.objects, {browseName: "Robot02"});

    var opcua_servos = [];

    for(var i = 0; i < servoCount; i++)
	opcua_servos[i] = addOPCUAServoVariable(i, addressSpace, robot);

    var method = addressSpace.addMethod(robot, {
	nodeId: "ns=1;s=loadFile",
	description: "Tries to load a recorded robot movement and plays it.",
	browseName: "loadFile",
	inputArguments: [{
	    name: "fileName",
	    description: {text: "path to file to load and play."},
	    dataType: DataType.String
	}],
	outputArguments: []
    });
    
    method.bindMethod(function(inputArguments, context, callback){
	var callMethodResult = {
	    statusCode: StatusCodes.Good,
	    outputArguments:[]
	};

	var file = inputArguments[0].value;
	logAndWrite("OPCUA: Command received to load file " + file);
	logAndWrite("OPCUA: Call pythonscript to load and play file");
	playFile(file);
	callback(null, callMethodResult);
    });

    logAndWrite("OPCUA: Server successfully initialized.");

    initializeOpcuaClient();    
}

function onClientConnected(err){
    if(err){
	logAndWrite(err.toString().red);
	process.exit(-1);
    }
    client.createSession(onSessionCreated);
}

function onSessionCreated(err, sess){
    if(err){
	logAndWrite(err.toString().red);
	process.exit(-1);
    }
    else{
	session = sess;
    }
}

function initializeOpcuaClient(){
    client = new OPCUAClient({keepSessionAlive:true});
    client.connect("opc.tcp://" + os.hostname() + ":" + port, onClientConnected);
}

function readOpcuaVariable(nodeId, callback){
    var nodeToRead = { nodeId: nodeId,
		       atributeId: AttributeIds.Value}
    session.read(noteToRead, 0, callback);
}

function writeOpcuaVariable(nodeId, dataType, value, callback){
    var noteToWrite = { nodeId: nodeId,
			attributeId: AttributeIds.Value,
			value: {
			    statusCode: StatusCodes.Good,
			    value: {
				dataType: dataType,
				value: value
			    }
			}
		      }
    
    session.write(nodeToWrite, callback);
}

function callOpcuaMethod(nodeId, args, callback){
    var methodCallRequest = {
	objectId: "ns=1;i=1000", // Node ID of the robot arm
	methodId: nodeId,
	inputArguments: args
    };
    
    session.call(methodCallRequest, callback);
}

//####################################
//###Functions and methods for web3###
//####################################

function onWhisperMessagePosted(error, result){
    if(error){
	logAndWrite("WHISPER: " + error.toString().red);
	return
    }
}

function onWhisperMessageReceived(error, message, subscription){
    if(error){
	logAndWrite("WHISPER: " + error.toString().red);
	return;
    }

    sMessage = webSocket.utils.hexToString(message.payload);
    logAndWrite(("WHISPER: WhisperMessage received: " + sMessage).green);
    
    if(sMessage.startsWith("File=") && sMessage.length > "File=".length){
	logAndWrite(("WHISPER: Command received: " + sMessage).green);
	file = sMessage.split("=")[1];
	logAndWrite(("Call OPCUA-Method to load file " + file).green);
	var inputArgument = [{
	    dataType: DataType.String,
	    arrayType: VariantArrayType.Scalar, 
	    value: file
	}];
	callOpcuaMethod("ns=1;s=loadFile", inputArgument, function(err, result){
	    if(err) logAndWrite(err.toString().red);
	    else logAndWrite(result.toString().green);
	});
    }	       
}

function connectToEthNode(wsUri){
    webSocket = new web3(new web3.providers.WebsocketProvider(wsUri));
}

function setPassword(password, callback){
    webSocket.shh.generateSymKeyFromPassword(password, callback);
}

function subscribe(symKeyId, topic){
    var subscribeObject = {symKeyID: symKeyId, topics: [topic]};
    webSocket.shh.subscribe("messages", subscribeObject, onWhisperMessageReceived);
}

function post(symKeyId, topic, message){

    var hexMessage = websocket.utils.toHex(message);
    
    var postObject = {symKeyID: symKeyId,
		      topic: topic,
		      powTarget: 1.0,
		      powTime: 10,
		      payload: hexMessage};

    return webSocket.shh.post(postObject, onWhisperMessagePosted);
}

function initializeWhisperListener(password, topic){
    logAndWrite(("WHISPER: Connect to websocket: " + webSocketUri).green);
    connectToEthNode(webSocketUri);
    setPassword(password, function(err, id){
	if(err){
	    logAndWrite(err.toString().red);
	    exit(-1);
	}
	logAndWrite(("WHISPER: Whisper-password successfully set. KeyId: " + id).green);
	symKeyId = id;
	logAndWrite(("WHISPER: Subscribe to topic " + topic).green);
	subscribe(symKeyId, topic);
    });
    
}

//############################################
//###Functions and methods for python-shell###
//############################################

function onPythonMessage(message, script){
    if(printPythonConsole){
	var python = "PYTHON: " + message;
	logAndWrite(python.cyan);
    }
}

function onPythonError(err, script){
    logAndWrite(("PYTHON: " + err.toString()).red);
}

function onPythonClose(err, script){
    if(err) logAndWrite(("PYTHON: " + err.toString()).red);
    script.end(function(err, code, signal){onPythonEnd(err, code, signal, script)});
    
}

function onPythonEnd(err, code, signal, script){
    if(err) logAndWrite(("PYTHON: " + err.toString()).red);
}

function playFile(fileName){
    args = ["--File=" + fileName];
    runPythonScript(args);
}
    
function runPythonScript(args){
    pythonOptions.args = args;
    
    var script = new PythonShell(pythonScript, pythonOptions);
    script.on(python_message, function(message){onPythonMessage(message, script)});
    script.on(python_error, function(err){onPythonError(err, script)});
    script.on(python_close, function(err){onPythonClose(err, script)});
    return script;
}

// Main-Function

function logAndWrite(entry){
    console.log(entry);
    writeHistoryEntry(entry);
}

function writeHistoryEntry(entry){
    var date = new Date();
    entry = date + ": " + entry + "\r\n";
    fs.appendFile(historyFileName, entry, function(err){
	if(err)
	    console.log("Unable to write history file. Maybe missing privileges?".red);
    });
}

function getCLIArguments(){
    port = argv.port;
    applicationName = argv.applicationName;
    pythonScript = argv.python;
    webSocketUri = argv.webSocketUri;
    servoCount = argv.servoCount;
    updateInterval = argv.updateInterval
    printPythonConsole = argv.printPythonConsole;
    whisperPassword = argv.whisperPassword;
    whisperTopic = argv.whisperTopic;
    historyFileName = argv.historyFile;
}

function main(){
    getCLIArguments();
    servos = [];

    for(var i = 0; i < servoCount; i++)
	servos[i] = 1.5;

    var servoValueUpdater = setInterval(updateServoValues, updateInterval);
    
    // var userManager = {
    // isValidUser: function(userName, password){
    // return (userName == argv.user && password == argv.password);
    // }
    //}

    var server_options = {
	port: port,
	serverInfo: {
	    applicationName: {text: applicationName, locale: "de"}
	}
    }

    server = new OPCUAServer(server_options);

    server.on(opcua_post_initialize, opcuaServerPostInitialize);

    server.start(function (err) {
	if(err){
	    logAndWrite("Server failed to start ... exiting");
	    logAndWrite(err.toString().red);
	    process.exit(-3);
	}
    });

    moveArmToInitialPosition()
    initializeWhisperListener(whisperPassword, whisperTopic);
}

main();
