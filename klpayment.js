  var UserPayment = Parse.Object.extend("UserPayment");
  var Card = Parse.Object.extend("Card");
  var KonvenePayment = Parse.Object.extend("Charge");

  var stripeSecretKey = "sk_live_4ZGEhsecTkKjo8xDRMvr89TA";
  var strpeBaseURL = "api.stripe.com/v1"; 

  var Stripe = require('stripe');

  Stripe.initialize(stripeSecretKey);
  
  function createCustomer(user, callBack) {
    Stripe.Customers.create({
      account_balance: 0,
      description: 'new stripe user',
      metadata: {
        userId: user.objectId,
        createWithCard: false
      }
    }, {
        success: function(httpResponse) {
          console.log("Success create" + httpResponse);
          callBack(httpResponse.id);
        },
        error: function(httpResponse) {
          console.log("Error while create" + httpResponse);
          callBack();
        }
    });
  }

  function getPaymentInfo(user, callBack) {
    var userPayment = user.get('paymentInfo');
    console.log(userPayment);
    if (userPayment !== undefined) {
      var fetchQuery = new Parse.Query(UserPayment);
      fetchQuery.get(userPayment.id, {
        success: function(paymentInfo) {
          if (paymentInfo) {
            console.log("Payment info fetched");
            callBack(paymentInfo);
          } else {
            console.log("This payment info doesnt exist!");
            callBack();
          }
        },
        error: function(object, error) {
          console.log("error: "+error.code+" "+error.message);
          userPayment = new UserPayment();
          createCustomer(user, function(customerId){
            console.log("Create new customer " + customerId);
            userPayment.set("customerId", customerId);
            callBack(userPayment);
          });
        } 
      });
    } else {
      userPayment = new UserPayment();
      createCustomer(user, function(customerId){
        console.log("Create new customer " + customerId);
        userPayment.set("customerId", customerId);
        callBack(userPayment);
      });
    }
  }

  function getCard(cardId, callBack) {
    var fetchQuery = new Parse.Query(Card);
    fetchQuery.get(cardId, {
      success: function(card) {
        if (card) {
          callBack(card);
        } else {
          console.log("This payment info doesnt exist!");
          callBack();
        }
      },
      error: function(object, error) {
        console.log("error: "+error.code+" "+error.message);
        callBack();
      } 
    });
  }
 
  function addCard(user, source, callBack) {
    getPaymentInfo(user, function(paymentInfo){
      Parse.Cloud.httpRequest({
        method:"POST",
        url: "https://" + stripeSecretKey + ':@' + strpeBaseURL + "/customers/" + paymentInfo.get("customerId") + "/cards",
        body: "card=" + source,
        success: function(httpResponse) {
          var jsonResult = JSON.parse(httpResponse.text);
          var newCard = new Card();
          newCard.set("cardId", jsonResult.id);
          newCard.set("last4", jsonResult.last4);
          newCard.set("brand", jsonResult.brand);
          newCard.set("expMonth", jsonResult.exp_month);
          newCard.set("expYear", jsonResult.exp_year);
          paymentInfo.addUnique("cards", newCard);
          callBack(paymentInfo, null);
        },
        error: function(httpResponse) {
          console.log('Request failed with response code ' + httpResponse.status);
          var jsonResult = JSON.parse(httpResponse.text);
          callBack(null, jsonResult.error.message);
        }
      });
    });
  }

  function removeCard(user, cardId, callBack) {
    getCard(cardId, function(card){
      getPaymentInfo(user, function(paymentInfo){
        paymentInfo.remove("cards", card);
        paymentInfo.save(null, {
          useMasterKey: true,
          success: function() {
            console.log("Save payment info ok");
            removeCardFromStripe(paymentInfo.get('customerId'), card, function(error){
              if (error) {
                card.destroy({
                  success: function(myObject) {
                    callBack(paymentInfo, null);
                  },
                  error: function(myObject, error) {
                    callBack(null, error);
                  }
                });
              } else {
                callBack(null, error);
              }
            });
          },
          error: function(object, error) {
            console.log("Save payment info error: "+error.code+" "+error.message);
            callBack(null, error);
          }
        });
      });
    });
  }

  function removeCardFromStripe(customerId, card, callBack) {
    Parse.Cloud.httpRequest({
      method:"DELETE",
      url: "https://" + stripeSecretKey + ':@' + strpeBaseURL + "/customers/" + customerId + "/sources/" + card.get("cardId"),
      success: function(httpResponse) {
        callBack(null);
      },
      error: function(httpResponse) {
        console.log('Request failed with response code ' + httpResponse.status);
        console.log(httpResponse);
        var jsonResult = JSON.parse(httpResponse.text);
        callBack(jsonResult.error.message);
      }
    });
  }
 
  function changeSource(customerId, card, callBack) {
    Parse.Cloud.httpRequest({
      method:"POST",
      url: "https://" + stripeSecretKey + ':@' + strpeBaseURL + "/customers/" + customerId,
      body: "source=" + card.get("cardId"),
      success: function(httpResponse) {
        callBack(null);
      },
      error: function(httpResponse) {
        console.log('Request failed with response code ' + httpResponse.status);
        var jsonResult = JSON.parse(httpResponse.text);
        callBack(jsonResult.error.message);
      }
    });
  }

  function charge(user, cardId, amount, callBack) {
    getCard(cardId, function(card){
      getPaymentInfo(user, function(paymentInfo){
        changeSource(paymentInfo.get("customerId"), card, function(errorMessage){
          if (errorMessage) {
            callBack(null, errorMessage);
          } else {
            var querystring = require('querystring');
            var body = querystring.stringify({'amount':amount*100 ,'currency':'usd','customer':paymentInfo.get("customerId")});

            Parse.Cloud.httpRequest({
              method:"POST",
              url: "https://" + stripeSecretKey + ':@' + strpeBaseURL + "/charges",
              body: body,
              success: function(httpResponse) {
                var jsonResult = JSON.parse(httpResponse.text);
                var newCahrge = new KonvenePayment();
                newCahrge.set("chargeId", jsonResult.id);
                newCahrge.set("owner", user);
                newCahrge.set("card", card);
                newCahrge.set("amount", amount);
                callBack(newCahrge, null);
              },
              error: function(httpResponse) {
                console.log('Request failed with response code ' + httpResponse.status);
                var jsonResult = JSON.parse(httpResponse.text);
                callBack(null, jsonResult.error.message);
              }
            });
          }
        });
      });
    });
  }
 
module.exports = {
  addCard: addCard,
  removeCard: removeCard,
  charge: charge
};