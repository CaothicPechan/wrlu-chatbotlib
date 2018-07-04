


import { constants } from './libs/config'
import express from 'express'
import bodyParser from 'body-parser'
import request from 'request'
import passport from 'passport'
import { Strategy } from 'passport-facebook'
import session from 'express-session'
import uuid from 'uuid'

import init from './libs/init'
import settings from './libs/settings'

import router from './routes/index'

import './models/facebookObjects'
import { Button } from './models/facebookObjects';

import fbProvider from './providers/facebook/fbProvider'
import dfProvider from './providers/dialogflow/dfProvider'





const app = express();

settings(app, constants);
router(app);


init(app);

let fbService = new fbProvider(constants.fb.graphMsgURL, constants.fb.pageToken, constants.fb.appSecret, constants.fb.verifyToken);
let dfService = new dfProvider(constants.googleProjectId, fbService);


const sessionIds = new Map();
const usersMap = new Map();

fbService.setWebhook(app, receivedMessage(event));


/*
 * All callbacks for Messenger are POST-ed. They will be sent to the same
 * webhook. Be sure to subscribe your app to your page to receive callbacks
 * for your page.
 * https://developers.facebook.com/docs/messenger-platform/product-overview/setup#subscribe_app
 *
 */
// app.post('/webhook/', function (req, res) {
// 	var data = req.body;
// 	console.log(JSON.stringify(data));


// 	// Make sure this is a page subscription
// 	if (data.object == 'page') {

// 		// Iterate over each entry
// 		// There may be multiple if batched
// 		data.entry.forEach((pageEntry) => {
// 			var pageID = pageEntry.id;
// 			var timeOfEvent = pageEntry.time;
// 			// Iterate over each messaging event
// 			pageEntry.messaging.forEach((messagingEvent) => {
// 				if (messagingEvent.optin) {
// 					fbService.receivedAuthentication(messagingEvent);
// 				} else if (messagingEvent.message) {
// 					receivedMessage(messagingEvent);
// 				} else if (messagingEvent.delivery) {
// 					fbService.receivedDeliveryConfirmation(messagingEvent);
// 				} else if (messagingEvent.postback) {
// 					receivedPostback(messagingEvent);
// 				} else if (messagingEvent.read) {
// 					fbService.receivedMessageRead(messagingEvent);
// 				} else if (messagingEvent.account_linking) {
// 					fbService.receivedAccountLink(messagingEvent);
// 				} else {
// 					console.log("Webhook received unknown messagingEvent: ", messagingEvent);
// 				}
// 			});
// 		});

// 		// Assume all went well.
// 		// You must send back a 200, within 20 seconds
// 		res.sendStatus(200);
// 	}
// });


function setSessionAndUser(senderID) {
	if (!sessionIds.has(senderID)) {
		sessionIds.set(senderID, uuid.v1());
	}
	// if (!usersMap.has(senderID)) {
	// 	userService.addUser(function(user){
	// 		usersMap.set(senderID, user);
	// 	}, senderID);
	// }
}

function receivedMessage(event) {

	var senderID = event.sender.id;
	var recipientID = event.recipient.id;
	var timeOfMessage = event.timestamp;
	var message = event.message;

	setSessionAndUser(senderID);

	//console.log("Received message for user %d and page %d at %d with message:", senderID, recipientID, timeOfMessage);
	//console.log(JSON.stringify(message));


	var isEcho = message.is_echo;
	var messageId = message.mid;
	var appId = message.app_id;
	var metadata = message.metadata;

	// You may get a text or attachment but not both
	var messageText = message.text;
	var messageAttachments = message.attachments;
	var quickReply = message.quick_reply;

	if (isEcho) {
		fbService.handleEcho(messageId, appId, metadata);
		return;
	} else if (quickReply) {
		handleQuickReply(senderID, quickReply, messageId);
		return;
	}


	if (messageText) {
		//send message to api.ai
		dfService.sendTextQueryToApiAi(sessionIds, handleApiAiResponse, senderID, messageText);
	} else if (messageAttachments) {
		fbService.handleMessageAttachments(messageAttachments, senderID);
	}
}

/*
 * Postback Event
 *
 * This event is called when a postback is tapped on a Structured Message.
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/postback-received
 *
 */
function receivedPostback(event) {
	var senderID = event.sender.id;
	var recipientID = event.recipient.id;
	var timeOfPostback = event.timestamp;

	// The 'payload' param is a developer-defined field which is set in a postback
	// button for Structured Messages.
	var payload = event.postback.payload;

	setSessionAndUser(senderID);

	switch (payload) {
		case 'FUN_NEWS':
			sendFunNewsSubscribe(senderID);
			break;
		case 'GET_STARTED':
			greetUserText(senderID);
			break;
		case 'JOB_APPLY':
			//get feedback with new jobs
            dfService.sendEventToApiAi(sessionIds, handleApiAiResponse, senderID, "JOB_OPENINGS");
			break;
		case 'CHAT':
			//user wants to chat
			fbService.sendTextMessage(senderID, "I love chatting too. Do you have any other questions for me?");
			break;
		default:
			//unindentified payload
			fbService.sendTextMessage(senderID, "I'm not sure what you want. Can you be more specific?");
			break;

	}

	console.log("Received postback for user %d and page %d with payload '%s' " +
		"at %d", senderID, recipientID, payload, timeOfPostback);

}


function handleApiAiResponse(sender, response) {
	let responseText = response.fulfillmentText;
  
	let messages = response.fulfillmentMessages;
	let action = response.action;
	let contexts = response.outputContexts;
	let parameters = response.parameters;
  
	fbService.sendTypingOff(sender);
  
	 if (action) {
		 handleApiAiAction(sender, action, messages, contexts, parameters);
	 } else if (messages ) {
	   fbService.handleMessages(messages);
	} else if (responseText == '' && !action) {
	   //api ai could not evaluate input.
	   //console.log('Unknown query' + response.result.resolvedQuery);
	   fbService.sendTextMessage(sender, "I'm not sure what you want. Can you be more specific?");
  
	} else if (responseText) {
	   fbService.sendTextMessage(sender, responseText);
	}
 }



 function handleApiAiAction(sender, action, messages, contexts, parameters) {
	switch (action) {
		default:
		  //unhandled action, just send back the text
			 fbService.handleMessages(messages, sender);
		// case "unsubscribe":
		// 	 userService.newsletterSettings(function(updated) {
		// 		 if (updated) {
		// 			 fbService.sendTextMessage(sender, "You're unsubscribed. You can always subscribe back!");
		// 		 } else {
		// 			 fbService.sendTextMessage(sender, "Newsletter is not available at this moment." +
		// 				 "Try again later!");
		// 		 }
		// 	 }, 0, sender);
		//   break;
	// 	 case "buy.iphone":
	// 		 colors.readUserColor(function(color) {
	// 				 let reply;
	// 				 if (color === '') {
	// 					 reply = 'In what color would you like to have it?';
	// 				 } else {
	// 					 reply = `Would you like to order it in your favourite color ${color}?`;
	// 				 }
	// 		 fbService.sendTextMessage(sender, reply);
  
	// 			 }, sender
	// 		 )
	// 		 break;
	// 	 case "iphone_colors.fovourite":
	// 		 colors.updateUserColor(parameters.fields['color'].stringValue, sender);
	// 		 let reply = `Oh, I like it, too. I'll remember that.`;
	// 	  fbService.sendTextMessage(sender, reply);
  
	// 		 break;
	// 	 case "iphone_colors":
	// 		 colors.readAllColors(function (allColors) {
	// 			 let allColorsString = allColors.join(', ');
	// 			 let reply = `IPhone 8 is available in ${allColorsString}. What is your favourite color?`;
	// 		 fbService.sendTextMessage(sender, reply);
	// 		 });
  
	// 		 break;
	//    case "get-current-weather":
	// 	  if ( parameters.fields['geo-city'].stringValue!='') {
  
	// 		 weatherService(function(weatherResponse){
	// 			if (!weatherResponse) {
	// 			   fbService.sendTextMessage(sender,
	// 				  `No weather forecast available for ${parameters.fields['geo-city'].stringValue}`);
	// 			} else {
	// 			   let reply = `${messages[0].text.text} ${weatherResponse}`;
	// 			   fbService.sendTextMessage(sender, reply);
	// 			}
  
  
	// 		 }, parameters.fields['geo-city'].stringValue);
	// 	  } else {
	// 		 fbService.handleMessages(messages, sender);
	// 	  }
	// 	  break;
	//    case "faq-delivery":
	// 		 messages[0].text.text.forEach((text) => {
	// 			 if (text !== '') {
	// 				 fbService.sendTextMessage(sender, text);
	// 			 }
	// 		 });
	// 	  fbService.sendTypingOn(sender);
  
	// 	  //ask what user wants to do next
	// 	  setTimeout(function() {
	// 		 let buttons = [
	// 			{
	// 			   type:"web_url",
	// 			   url:"https://www.myapple.com/track_order",
	// 			   title:"Track my order"
	// 			},
	// 			{
	// 			   type:"phone_number",
	// 			   title:"Call us",
	// 			   payload:"+16505551234",
	// 			},
	// 			{
	// 			   type:"postback",
	// 			   title:"Keep on Chatting",
	// 			   payload:"CHAT"
	// 			}
	// 		 ];
  
	// 		 fbService.sendButtonMessage(sender, "What would you like to do next?", buttons);
	// 	  }, 3000)
  
	// 	  break;
	//    case "detailed-application":
	// 	  if (isDefined(contexts[0]) &&
	// 		 (contexts[0].name.includes('job_application') || contexts[0].name.includes('job-application-details_dialog_context'))
	// 		 && contexts[0].parameters) {
	// 		 let phone_number = (isDefined(contexts[0].parameters.fields['phone-number'])
	// 		 && contexts[0].parameters.fields['phone-number']!= '') ? contexts[0].parameters.fields['phone-number'].stringValue : '';
	// 		 let user_name = (isDefined(contexts[0].parameters.fields['user-name'])
	// 		 && contexts[0].parameters.fields['user-name']!= '') ? contexts[0].parameters.fields['user-name'].stringValue : '';
	// 		 let previous_job = (isDefined(contexts[0].parameters.fields['previous-job'])
	// 		 && contexts[0].parameters.fields['previous-job']!= '') ? contexts[0].parameters.fields['previous-job'].stringValue : '';
	// 		 let years_of_experience = (isDefined(contexts[0].parameters.fields['years-of-experience'])
	// 		 && contexts[0].parameters.fields['years-of-experience']!= '') ? contexts[0].parameters.fields['years-of-experience'].stringValue : '';
	// 		 let job_vacancy = (isDefined(contexts[0].parameters.fields['job-vacancy'])
	// 		 && contexts[0].parameters.fields['job-vacancy']!= '') ? contexts[0].parameters.fields['job-vacancy'].stringValue : '';
  
  
	// 		 if (phone_number == '' && user_name != '' && previous_job != '' && years_of_experience == '') {
  
	// 			let replies = [
	// 			   {
	// 				  "content_type":"text",
	// 				  "title":"Less than 1 year",
	// 				  "payload":"Less than 1 year"
	// 			   },
	// 			   {
	// 				  "content_type":"text",
	// 				  "title":"Less than 10 years",
	// 				  "payload":"Less than 10 years"
	// 			   },
	// 			   {
	// 				  "content_type":"text",
	// 				  "title":"More than 10 years",
	// 				  "payload":"More than 10 years"
	// 			   }
	// 			];
	// 			fbService.sendQuickReply(sender, messages[0].text.text[0], replies);
	// 		 } else if (phone_number != '' && user_name != '' && previous_job != '' && years_of_experience != ''
	// 			&& job_vacancy != '') {
	// 			jobApplicationCreate(phone_number, user_name, previous_job, years_of_experience, job_vacancy);
	// 				 messages[0].text.text.forEach((text) => {
	// 					 if (text !== '') {
	// 						 fbService.sendTextMessage(sender, text);
	// 					 }
	// 				 });
	// 		 } else {
	// 				 messages[0].text.text.forEach((text) => {
	// 					 if (text !== '') {
	// 						 fbService.sendTextMessage(sender, text);
	// 					 }
	// 				 });
	// 		 }
	// 	  }
	// 	  break;
	   
	}
 }
// function handleApiAiResponse(sender, response) {

// 	let responseText = response.result.fulfillment.speech;
// 	let responseData = response.result.fulfillment.data;
// 	let messages = response.result.fulfillment.messages;
// 	let action = response.result.action;
// 	let contexts = response.result.contexts;
// 	let parameters = response.result.parameters;

// 	fbService.sendTypingOff(sender);

// 	if (isDefined(messages) && (messages.length == 1 && messages[0].type != 0 || messages.length > 1)) {
// 		let timeoutInterval = 1100;
// 		let previousType ;
// 		let cardTypes = [];
// 		let timeout = 0;
// 		for (var i = 0; i < messages.length; i++) {

// 			if ( previousType == 1 && (messages[i].type != 1 || i == messages.length - 1)) {

// 				timeout = (i - 1) * timeoutInterval;
// 				setTimeout(fbService.handleCardMessages.bind(null, cardTypes, sender), timeout);
// 				cardTypes = [];
// 				timeout = i * timeoutInterval;
// 				setTimeout(fbService.handleMessage.bind(null, messages[i], sender), timeout);
// 			} else if ( messages[i].type == 1 && i == messages.length - 1) {
// 				cardTypes.push(messages[i]);
//                 timeout = (i - 1) * timeoutInterval;
//                 setTimeout(fbService.handleCardMessages.bind(null, cardTypes, sender), timeout);
//                 cardTypes = [];
//             } else if ( messages[i].type == 1) {
//                 cardTypes.push(messages[i]);
// 			} else {
// 				timeout = i * timeoutInterval;
// 				setTimeout(fbService.handleMessage.bind(null, messages[i], sender), timeout);
// 			}

// 			previousType = messages[i].type;

// 		}

// 	} else if (responseText == '' && !isDefined(action)) {
// 		//api ai could not evaluate input.
// 		//console.log('Unknown query' + response.result.resolvedQuery);
// 		fbService.sendTextMessage(sender, "I'm not sure what you want. Can you be more specific?");
// 	} else if (isDefined(action)) {
// 		handleApiAiAction(sender, action, responseText, contexts, parameters);
// 	} else if (isDefined(responseData) && isDefined(responseData.facebook)) {
// 		try {
// 			fbService.sendTextMessage(sender, responseData.facebook);
// 		} catch (err) {
// 			fbService.sendTextMessage(sender, err.message);
// 		}
// 	} else if (isDefined(responseText)) {
// 		fbService.sendTextMessage(sender, responseText);
// 	}
// }


// function handleApiAiAction(sender, action, responseText, contexts, parameters) {
// 	switch (action) {
// 		case "unsubscribe":
//             userService.newsletterSettings(function(updated) {
//                 if (updated) {
//                     fbService.sendTextMessage(sender, "You're unsubscribed. You can always subscribe back!");
//                 } else {
//                     fbService.sendTextMessage(sender, "Newsletter is not available at this moment." +
//                         "Try again later!");
//                 }
//             }, 0, sender);
// 			break;
//         case "buy.iphone":
//             colors.readUserColor(function(color) {
//                     let reply;
//                     if (color === '') {
//                         reply = 'In what color would you like to have it?';
//                     } else {
//                         reply = `Would you like to order it in your favourite color ${color}?`;
//                     }
// 				fbService.sendTextMessage(sender, reply);

//                 }, sender
//             )
//             break;
//         case "iphone_colors.favourite":
//             colors.updateUserColor(parameters['color'], sender);
//             let reply = `Oh, I like it, too. I'll remember that.`;
// 			fbService.sendTextMessage(sender, reply);

//             break;
//         case "iphone-colors":
//             colors.readAllColors(function (allColors) {
//                 let allColorsString = allColors.join(', ');
//                 let reply = `IPhone 8 is available in ${allColorsString}. What is your favourite color?`;
// 				fbService.sendTextMessage(sender, reply);
//             });

//             break;
// 		case "faq-delivery":
// 			fbService.sendTextMessage(sender, responseText);
// 			fbService.sendTypingOn(sender);

// 			//ask what user wants to do next
// 			setTimeout(function() {
// 				let buttons = [
// 					{
// 						type:"web_url",
// 						url:"https://www.myapple.com/track_order",
// 						title:"Track my order"
// 					},
// 					{
// 						type:"phone_number",
// 						title:"Call us",
// 						payload:"+16505551234",
// 					},
// 					{
// 						type:"postback",
// 						title:"Keep on Chatting",
// 						payload:"CHAT"
// 					}
// 				];

// 				fbService.sendButtonMessage(sender, "What would you like to do next?", buttons);
// 			}, 3000)

// 			break;
// 		case "detailed-application":
// 			if (isDefined(contexts[0]) &&
// 				(contexts[0].name == 'job_application' || contexts[0].name == 'job-application-details_dialog_context')
// 				&& contexts[0].parameters) {
// 				let phone_number = (isDefined(contexts[0].parameters['phone-number'])
// 				&& contexts[0].parameters['phone-number']!= '') ? contexts[0].parameters['phone-number'] : '';
// 				let user_name = (isDefined(contexts[0].parameters['user-name'])
// 				&& contexts[0].parameters['user-name']!= '') ? contexts[0].parameters['user-name'] : '';
// 				let previous_job = (isDefined(contexts[0].parameters['previous-job'])
// 				&& contexts[0].parameters['previous-job']!= '') ? contexts[0].parameters['previous-job'] : '';
// 				let years_of_experience = (isDefined(contexts[0].parameters['years-of-experience'])
// 				&& contexts[0].parameters['years-of-experience']!= '') ? contexts[0].parameters['years-of-experience'] : '';
// 				let job_vacancy = (isDefined(contexts[0].parameters['job-vacancy'])
// 				&& contexts[0].parameters['job-vacancy']!= '') ? contexts[0].parameters['job-vacancy'] : '';


// 				if (phone_number == '' && user_name != '' && previous_job != '' && years_of_experience == '') {

// 					let replies = [
// 						{
// 							"content_type":"text",
// 							"title":"Less than 1 year",
// 							"payload":"Less than 1 year"
// 						},
// 						{
// 							"content_type":"text",
// 							"title":"Less than 10 years",
// 							"payload":"Less than 10 years"
// 						},
// 						{
// 							"content_type":"text",
// 							"title":"More than 10 years",
// 							"payload":"More than 10 years"
// 						}
// 					];
// 					fbService.sendQuickReply(sender, responseText, replies);
// 				} else if (phone_number != '' && user_name != '' && previous_job != '' && years_of_experience != ''
// 					&& job_vacancy != '') {
// 					jobApplicationCreate(phone_number, user_name, previous_job, years_of_experience, job_vacancy);
// 					fbService.sendTextMessage(sender, responseText);
// 				} else {
// 					fbService.sendTextMessage(sender, responseText);
// 				}
// 			}
// 			break;
// 		case "job-enquiry":
// 			let replies = [
// 				{
// 					"content_type":"text",
// 					"title":"Accountant",
// 					"payload":"Accountant"
// 				},
// 				{
// 					"content_type":"text",
// 					"title":"Sales",
// 					"payload":"Sales"
// 				},
// 				{
// 					"content_type":"text",
// 					"title":"Not interested",
// 					"payload":"Not interested"
// 				}
// 			];
// 			fbService.sendQuickReply(sender, responseText, replies);
// 			break;
// 		default:
// 			//unhandled action, just send back the text
// 			//console.log("send responce in handle actiongit: " + responseText);
// 			fbService.sendTextMessage(sender, responseText);
// 	}
// }